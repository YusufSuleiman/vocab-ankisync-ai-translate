import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, Vault, Menu, Modal } from "obsidian";

interface ColumnStyle {
    color: string;
    fontSize: string;
    fontWeight: string;
}

interface LanguageConfig {
    code: string;
    name: string;
    nativeName: string;
    rtl: boolean;
    flag: string;
}

interface GroqTranslationResult {
    translation: string;
    definition: string;
    exampleSource: string;
    exampleTarget: string;
}

interface UsageStats {
    totalWordsProcessed: number;
    successfulBatches: number;
    failedBatches: number;
    totalBatches: number;
    totalBatchSize: number;
}

interface RemoteConfig {
    last_updated: string;
    update_info: {
        version: string;
        message: string;
        download_url: string;
        critical: boolean;
    };
    endpoints: {
        primary: string;
        backups: string[];
    };
    supported_languages: LanguageConfig[];
    models: {
        options: Record<string, string>;
        high_limit: string[];
        consensus_models: string[];
    };
}

interface MyPluginSettings {
    wordsFilePath: string;
    filePath: string;
    logLevel: string;
    logFolder: string;
    sourceLanguage: string;
    targetLanguage: string;
    deckName: string;
    noteType: string;
    ankiConnectPort: number;
    frontColumn: number;
    ankiTags: string;
    enableCustomTags: boolean;
    column1Style: ColumnStyle;
    column2Style: ColumnStyle;
    column3Style: ColumnStyle;
    column4Style: ColumnStyle;
    column5Style: ColumnStyle;
    column6Style: ColumnStyle;
    groqModel: string;
    batchSize: number;
    useJSONFormat: boolean;
    requestsPerMinute: number;
    enableRateLimiting: boolean;
    enableSchemaCheck: boolean;
    showFrontWarning: boolean;
    autoSync: boolean;
    translationQuality: 'standard' | 'professional' | 'comprehensive';
    enablePositionalFallback: boolean;
    dryRun: boolean;
    ribbonSide: 'left' | 'right';
    ribbonOrder: number;
    cacheTTLHours: number;
    enableCancelButton: boolean;
    showProgressDialog: boolean;
    smartAutoMode: boolean;
    glossaryEntries: Array<{ source: string; target: string; notes?: string; exact?: boolean }>;
    doNotTranslateList: string[];
    qualityScoreThreshold: number;
    enableAdaptiveBatching: boolean;
    enableQualityScoring: boolean;
    enableConsensus: boolean;
    consensusModels: string[];
    consensusStrategy: 'best-score' | 'majority' | 'merge';
    consensusTriggerThreshold: number;
    consensusMaxModels: number;
    consensusBudgetPerRun: number;
    learnerLevel: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
    simplifyExamplesForBeginners: boolean;
    addNuanceForAdvanced: boolean;
    limitDefinitionLength: boolean;
    meaningsCount: number;
    activeWorkerUrl: string;
    backupWorkerUrls: string[];
    autoEndpointSwitch: boolean;
    enableUpdateNotifications: boolean;
    cachedServerUpdateVersion?: string;
    availableModels?: Record<string, string>;
    highLimitModels?: string[];
    activeModelIndex?: number;
    maxNonModelFailures?: number;
    remoteConfig?: RemoteConfig;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    wordsFilePath: "",
    filePath: "",
    logLevel: "detailed",
    logFolder: "",
    sourceLanguage: 'en',
    targetLanguage: 'ar',
    deckName: "Default",
    noteType: "Basic",
    ankiConnectPort: 8765,
    frontColumn: 2,
    ankiTags: "obsidian-vocabulary",
    enableCustomTags: true,
    column1Style: { color: "#cccccc", fontSize: "14px", fontWeight: "normal" },
    column2Style: { color: "#ffffff", fontSize: "18px", fontWeight: "bold" },
    column3Style: { color: "#ffff00", fontSize: "16px", fontWeight: "normal" },
    column4Style: { color: "#00ff00", fontSize: "14px", fontWeight: "normal" },
    column5Style: { color: "#00ffff", fontSize: "14px", fontWeight: "normal" },
    column6Style: { color: "#ff00ff", fontSize: "14px", fontWeight: "italic" },
    groqModel: "",
    batchSize: 8,
    useJSONFormat: true,
    enableRateLimiting: true,
    requestsPerMinute: 15,
    showFrontWarning: true,
    autoSync: false,
    translationQuality: "professional",
    enablePositionalFallback: true,
    enableSchemaCheck: true,
    dryRun: false,
    ribbonSide: 'left',
    ribbonOrder: 9999,
    cacheTTLHours: 24,
    enableCancelButton: true,
    showProgressDialog: true,
    smartAutoMode: true,
    glossaryEntries: [],
    doNotTranslateList: [],
    qualityScoreThreshold: 0.7,
    enableAdaptiveBatching: true,
    enableQualityScoring: true,
    enableConsensus: false,
    consensusModels: [],
    consensusStrategy: 'best-score',
    consensusTriggerThreshold: 0.75,
    consensusMaxModels: 2,
    consensusBudgetPerRun: 8,
    learnerLevel: 'B1',
    simplifyExamplesForBeginners: true,
    addNuanceForAdvanced: true,
    limitDefinitionLength: false,
    meaningsCount: 1,
    activeWorkerUrl: "",
    backupWorkerUrls: [],
    autoEndpointSwitch: true,
    enableUpdateNotifications: true,
    cachedServerUpdateVersion: undefined,
    availableModels: {},
    highLimitModels: [],
    activeModelIndex: 0,
    maxNonModelFailures: 3,
    remoteConfig: undefined
};

const ERROR_CATEGORIES = {
    MODEL: 'model',
    JSON: 'json',
    RATE_LIMIT: 'rate_limit',
    NETWORK: 'network',
    SERVER: 'server',
    PARSE: 'parse',
    VALIDATION: 'validation',
    CAPACITY: 'capacity',
    MODEL_CAPACITY: 'model_capacity'
} as const;

type ErrorCategory = typeof ERROR_CATEGORIES[keyof typeof ERROR_CATEGORIES];

interface OperationSummary {
    operationId: string;
    startTime: Date;
    endTime?: Date;
    totalWords: number;
    processedWords: number;
    successCount: number;
    failureCount: number;
    errorCategories: Map<ErrorCategory, number>;
    finalStatus: 'completed' | 'cancelled' | 'failed';
    failureReason?: string;
    suggestions: string[];
}
class RemoteConfigManager {
    private static readonly CONFIG_URL = 'https://raw.githubusercontent.com/YusufSuleiman/vocab-ankisync-ai-translate/main/docs/apiConfig.json';

    static async loadConfig(): Promise<RemoteConfig> {
        try {
            const response = await fetch(this.CONFIG_URL);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const config = await response.json();
            return this.validateConfig(config);
        } catch (error) {
            console.error('Failed to load remote config:', error);
            return this.getDefaultConfig();
        }
    }

    private static validateConfig(config: any): RemoteConfig {

        if (!config.endpoints?.primary) {
            throw new Error('Invalid config: missing endpoints');
        }
        if (!config.models?.options) {
            throw new Error('Invalid config: missing models');
        }
        if (!Array.isArray(config.supported_languages)) {
            throw new Error('Invalid config: missing supported_languages');
        }

        return {
            last_updated: config.last_updated || new Date().toISOString(),
            update_info: config.update_info || {
                version: "1.0.0",
                message: "Using default configuration",
                download_url: "",
                critical: false
            },
            endpoints: {
                primary: config.endpoints.primary,
                backups: config.endpoints.backups || []
            },
            supported_languages: config.supported_languages,
            models: {
                options: config.models.options,
                high_limit: config.models.high_limit || [],
                consensus_models: config.models.consensus_models || []
            }
        };
    }

    private static getDefaultConfig(): RemoteConfig {
        return {
            last_updated: new Date().toISOString(),
            update_info: {
                version: "1.0.0",
                message: "Using default configuration",
                download_url: "",
                critical: false
            },
            endpoints: {
                primary: "https://vocab-translation-service2.yosef200122.workers.dev/",
                backups: []
            },
            supported_languages: [],
            models: {
                options: {},
                high_limit: [],
                consensus_models: []
            }
        };
    }
}

class ErrorClassifier {
    static categorizeError(error: any): ErrorCategory {
        const errorMessage = error.message?.toLowerCase() || error.toString().toLowerCase();
        const statusCode = error.status || error.statusCode;

        if (errorMessage.includes('over capacity') ||
            errorMessage.includes('currently over capacity') ||
            errorMessage.includes('capacity exceeded') ||
            errorMessage.includes('is currently over capacity')) {
            return ERROR_CATEGORIES.CAPACITY;
        }

        if ((errorMessage.includes('model') && errorMessage.includes('capacity')) ||
            (errorMessage.includes('llama') && errorMessage.includes('capacity'))) {
            return ERROR_CATEGORIES.MODEL_CAPACITY;
        }

        if (errorMessage.includes('model') ||
            errorMessage.includes('does not exist') ||
            errorMessage.includes('not available') ||
            errorMessage.includes('you do not have access') ||
            errorMessage.includes('model_not_available') ||
            errorMessage.includes('model_required')) {
            return ERROR_CATEGORIES.MODEL;
        }

        if (errorMessage.includes('rate limit') ||
            errorMessage.includes('too many requests') ||
            errorMessage.includes('rate_limit') ||
            statusCode === 429) {
            return ERROR_CATEGORIES.RATE_LIMIT;
        }

        if (errorMessage.includes('json') ||
            errorMessage.includes('parse') ||
            errorMessage.includes('invalid json') ||
            errorMessage.includes('json_validate_failed')) {
            return ERROR_CATEGORIES.JSON;
        }

        if (errorMessage.includes('network') ||
            errorMessage.includes('timeout') ||
            errorMessage.includes('fetch') ||
            errorMessage.includes('connection') ||
            errorMessage.includes('aborted')) {
            return ERROR_CATEGORIES.NETWORK;
        }

        if (statusCode >= 500 && statusCode < 600) {
            return ERROR_CATEGORIES.SERVER;
        }

        if (errorMessage.includes('parsing') ||
            errorMessage.includes('invalid response') ||
            errorMessage.includes('unexpected token')) {
            return ERROR_CATEGORIES.PARSE;
        }

        if (errorMessage.includes('valid') ||
            errorMessage.includes('validation') ||
            errorMessage.includes('invalid')) {
            return ERROR_CATEGORIES.VALIDATION;
        }

        return ERROR_CATEGORIES.SERVER;
    }

    static getErrorPolicy(category: ErrorCategory): { retryable: boolean; maxRetries: number; backoffMultiplier: number } {
        switch (category) {
            case ERROR_CATEGORIES.MODEL:
                return { retryable: false, maxRetries: 0, backoffMultiplier: 1 };
            case ERROR_CATEGORIES.RATE_LIMIT:
                return { retryable: true, maxRetries: 2, backoffMultiplier: 2 };
            case ERROR_CATEGORIES.JSON:
                return { retryable: true, maxRetries: 1, backoffMultiplier: 1 };
            case ERROR_CATEGORIES.NETWORK:
                return { retryable: true, maxRetries: 3, backoffMultiplier: 2 };
            case ERROR_CATEGORIES.SERVER:
                return { retryable: true, maxRetries: 2, backoffMultiplier: 1.5 };
            case ERROR_CATEGORIES.PARSE:
                return { retryable: true, maxRetries: 1, backoffMultiplier: 1 };
            case ERROR_CATEGORIES.VALIDATION:
                return { retryable: false, maxRetries: 0, backoffMultiplier: 1 };
            case ERROR_CATEGORIES.CAPACITY:
                return { retryable: true, maxRetries: 2, backoffMultiplier: 3 };
            case ERROR_CATEGORIES.MODEL_CAPACITY:
                return { retryable: true, maxRetries: 1, backoffMultiplier: 5 };
            default:
                return { retryable: true, maxRetries: 1, backoffMultiplier: 1 };
        }
    }

    static getSuggestion(category: ErrorCategory, context: any = {}): string {
        const model = context.model || 'current model';

        switch (category) {
            case ERROR_CATEGORIES.MODEL:
                return `Switch to a different model. "${model}" is not available.`;
            case ERROR_CATEGORIES.RATE_LIMIT:
                return `Reduce request rate or switch to a high-limit model.`;
            case ERROR_CATEGORIES.JSON:
                return `Try reducing batch size or disabling JSON format temporarily.`;
            case ERROR_CATEGORIES.NETWORK:
                return `Check internet connection and try again.`;
            case ERROR_CATEGORIES.SERVER:
                return `Service temporarily unavailable. Try again in a few minutes.`;
            case ERROR_CATEGORIES.PARSE:
                return `Response format issue. Try simplifying the request.`;
            case ERROR_CATEGORIES.VALIDATION:
                return `Check input data format and requirements.`;
            case ERROR_CATEGORIES.CAPACITY:
                return `Service is currently at capacity. Wait a moment and try again.`;
            case ERROR_CATEGORIES.MODEL_CAPACITY:
                return `The model "${model}" is currently overloaded. Try a different model or wait.`;
            default:
                return `Unknown error occurred. Check logs for details.`;
        }
    }
}

/**
 * Circuit Breaker for Network Stability
 */
class CircuitBreaker {
    private failureCount = 0;
    private lastFailureTime = 0;
    private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    private readonly failureThreshold = 3;
    private readonly resetTimeout = 30000;

    constructor(private name: string) { }

    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.resetTimeout) {
                this.state = 'HALF_OPEN';
            } else {
                throw new Error(`Circuit breaker OPEN for ${this.name}. Too many failures.`);
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        this.failureCount = 0;
        this.state = 'CLOSED';
    }

    private onFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }

    getState(): string {
        return this.state;
    }
}

/**
 * Exponential Backoff with Maximum Cap
 */
class ExponentialBackoff {
    private attemptCount = 0;
    private readonly baseDelay = 1000;
    private readonly maxDelay = 30000;
    private readonly maxAttempts = 5;

    async wait(): Promise<void> {
        if (this.attemptCount >= this.maxAttempts) {
            throw new Error('Maximum backoff attempts reached');
        }

        const delay = Math.min(
            this.baseDelay * Math.pow(2, this.attemptCount),
            this.maxDelay
        );

        this.attemptCount++;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    reset(): void {
        this.attemptCount = 0;
    }

    getCurrentDelay(): number {
        return Math.min(
            this.baseDelay * Math.pow(2, this.attemptCount),
            this.maxDelay
        );
    }
}

/**
 * Legendary Operation Summary System
 */
class OperationSummaryManager {
    private currentSummary: OperationSummary | null = null;

    startOperation(operationId: string, totalWords: number): void {
        this.currentSummary = {
            operationId,
            startTime: new Date(),
            totalWords,
            processedWords: 0,
            successCount: 0,
            failureCount: 0,
            errorCategories: new Map(),
            finalStatus: 'completed',
            suggestions: []
        };
    }

    recordSuccess(words: number): void {
        if (!this.currentSummary) return;
        this.currentSummary.successCount++;
        this.currentSummary.processedWords += words;
    }

    recordFailure(error: any, words: number): void {
        if (!this.currentSummary) return;
        this.currentSummary.failureCount++;
        this.currentSummary.processedWords += words;

        const category = ErrorClassifier.categorizeError(error);
        const currentCount = this.currentSummary.errorCategories.get(category) || 0;
        this.currentSummary.errorCategories.set(category, currentCount + 1);

        const suggestion = ErrorClassifier.getSuggestion(category, error);
        if (!this.currentSummary.suggestions.includes(suggestion)) {
            this.currentSummary.suggestions.push(suggestion);
        }
    }

    completeOperation(status: 'completed' | 'cancelled' | 'failed', failureReason?: string): OperationSummary {
        if (!this.currentSummary) {
            throw new Error('No operation in progress');
        }

        this.currentSummary.endTime = new Date();
        this.currentSummary.finalStatus = status;
        if (failureReason) {
            this.currentSummary.failureReason = failureReason;
        }

        const summary = this.currentSummary;
        this.currentSummary = null;
        return summary;
    }

    getCurrentSummary(): OperationSummary | null {
        return this.currentSummary;
    }

    generateSummaryReport(summary: OperationSummary): string {
        const duration = summary.endTime
            ? Math.round((summary.endTime.getTime() - summary.startTime.getTime()) / 1000)
            : 0;

        const errorCategories = Array.from(summary.errorCategories.entries())
            .map(([category, count]) => `${category}: ${count}`)
            .join(', ');

        return `
🏁 OPERATION SUMMARY
────────────────────────────────
📊 Status: ${summary.finalStatus.toUpperCase()}
⏱️  Duration: ${duration}s
📝 Operation: ${summary.operationId}
📦 Total Words: ${summary.totalWords}
✅ Processed: ${summary.processedWords}
🎯 Success: ${summary.successCount}
❌ Failures: ${summary.failureCount}
🚨 Error Types: ${errorCategories || 'None'}
💡 Suggestions:
${summary.suggestions.map(s => `• ${s}`).join('\n')}
${summary.failureReason ? `🔴 Failure Reason: ${summary.failureReason}` : ''}
────────────────────────────────
        `.trim();
    }
}

class AdaptiveBatchController {
    private currentBatchSize: number;
    private recentSuccesses: number = 0;
    private recentFailures: number = 0;
    private windowSize: number = 5;
    private minBatchSize: number = 1;
    private maxBatchSize: number;
    private baselineBatchSize: number;

    constructor(initialSize: number, maxSize: number = 20) {
        this.currentBatchSize = initialSize;
        this.baselineBatchSize = initialSize;
        this.maxBatchSize = maxSize;
    }

    onSuccess(): void {
        this.recentSuccesses++;
        if (this.recentSuccesses >= this.windowSize && this.currentBatchSize < this.maxBatchSize) {
            this.currentBatchSize = Math.min(this.currentBatchSize + 1, this.maxBatchSize);
            this.recentSuccesses = 0;
        }
    }

    onFailure(): void {
        this.recentFailures++;
        this.recentSuccesses = 0;
        if (this.recentFailures >= 2 && this.currentBatchSize > this.minBatchSize) {
            this.currentBatchSize = Math.max(Math.floor(this.currentBatchSize * 0.7), this.minBatchSize);
            this.recentFailures = 0;
        }
    }

    getBatchSize(): number {
        return this.currentBatchSize;
    }

    reset(): void {
        this.currentBatchSize = this.baselineBatchSize;
        this.recentSuccesses = 0;
        this.recentFailures = 0;
    }
}

class AdvancedRateLimiter {
    private requests: number[] = [];
    private readonly windowMs: number = 60000;
    constructor(private getMaxRequests: () => number) { }

    async acquireSlot(): Promise<void> {
        const now = Date.now();
        this.cleanupOldRequests(now);

        const maxRequests = this.getMaxRequests();
        if (this.requests.length >= maxRequests) {
            const waitTime = this.calculateWaitTime(now);
            await this.delay(waitTime + 100);
            return await this.acquireSlot();
        }

        this.requests.push(now);
    }

    private cleanupOldRequests(now: number): void {
        this.requests = this.requests.filter(time => now - time < this.windowMs);
    }

    private calculateWaitTime(now: number): number {
        if (this.requests.length === 0) return 0;
        const oldestRequest = this.requests[0];
        return this.windowMs - (now - oldestRequest);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

class ProfessionalBatchManager {
    private rateLimiter: AdvancedRateLimiter;
    private adaptiveBatchController: AdaptiveBatchController | null = null;
    private consecutiveNonModelFailures: number = 0;
    private lastBackoffUntilTs: number = 0;
    private jsonErrorCount: number = 0;
    private rateLimitErrorCount: number = 0;
    private circuitBreaker: CircuitBreaker;
    private networkBackoff: ExponentialBackoff;
    private errorRetryCounts: Map<ErrorCategory, number> = new Map();




    private isValidTranslation(result: GroqTranslationResult): boolean {
        if (!result || !result.translation || result.translation.trim().length < 1) {
            console.log(`❌ REJECTED: No translation`);
            return false;
        }

        if (!result.definition || result.definition.trim().length < 10) {
            console.log(`❌ REJECTED: Short definition - "${result.definition}"`);
            return false;
        }

        const cleanDefinition = result.definition.replace(/[\s\.,;:!?\-()]/g, '');
        if (cleanDefinition.length < 5) {
            console.log(`❌ REJECTED: Symbols-only definition - "${result.definition}"`);
            return false;
        }

        if (result.definition.includes('، .') ||
            result.definition.includes(', .') ||
            result.definition.trim() === ',' ||
            result.definition.trim() === '،') {
            console.log(`❌ REJECTED: Corrupted definition pattern - "${result.definition}"`);
            return false;
        }

        if (!result.exampleSource || result.exampleSource.trim().length < 3 ||
            !result.exampleTarget || result.exampleTarget.trim().length < 3) {
            console.log(`❌ REJECTED: Short examples`);
            return false;
        }

        console.log(`✅ ACCEPTED: "${result.translation}" -> "${result.definition.substring(0, 30)}..."`);
        return true;
    }

    private createEmptyCacheEntry(): GroqTranslationResult {
        return {
            translation: '',
            definition: '',
            exampleSource: '',
            exampleTarget: ''
        };
    }

    private isEmptyCacheEntry(result: GroqTranslationResult): boolean {
        return (!result.translation || result.translation.trim() === '') &&
            (!result.definition || result.definition.trim() === '') &&
            (!result.exampleSource || result.exampleSource.trim() === '') &&
            (!result.exampleTarget || result.exampleTarget.trim() === '');
    }


    private async savePartialResultsToTable(
        results: Map<string, GroqTranslationResult>,
        sourceLang: string,
        targetLang: string
    ): Promise<void> {
        try {
            const normalizedPath = normalizePath(this.plugin.settings.filePath);
            const file = this.plugin.app.vault.getAbstractFileByPath(normalizedPath);

            if (!(file instanceof TFile)) {
                throw new Error("Vocabulary file not found");
            }

            const content = await this.plugin.app.vault.read(file);
            const lines = content.split("\n");

            const updatedContent = await this.updateTableWithPartialResults(lines, results, sourceLang, targetLang);

            await this.plugin.app.vault.modify(file, updatedContent);

            await this.plugin.logEvent(`💾 Successfully saved ${results.size} translations to table`, "success");

        } catch (error: any) {
            await this.plugin.logEvent(`❌ Failed to save partial results to table: ${error.message}`, "error");
            throw error;
        }
    }

    private async updateTableWithPartialResults(
        originalRows: string[],
        results: Map<string, GroqTranslationResult>,
        sourceLang: string,
        targetLang: string
    ): Promise<string> {
        const newRows: string[] = [];
        let updatedCount = 0;

        for (let i = 0; i < originalRows.length; i++) {
            const row = originalRows[i];

            if (!row.trim()) {
                newRows.push(row);
                continue;
            }

            if (!row.includes("|")) {
                newRows.push(row);
                continue;
            }

            const parts = this.splitTableRow(row);

            if (parts.length < 2) {
                newRows.push(row);
                continue;
            }

            const num = parts[0];
            const sourceWord = parts[1]?.trim();

            if (!sourceWord || this.isSeparatorRow(row) || this.isHeaderRow(row)) {
                newRows.push(row);
                continue;
            }

            const translation = parts[2] || "";
            const definition = parts[3] || "";
            const exampleSource = parts[4] || "";
            const exampleTarget = parts[5] || "";

            let foundResult: GroqTranslationResult | undefined = results.get(sourceWord);

            if (!foundResult) {
                for (const [key, value] of results.entries()) {
                    if (key.toLowerCase() === sourceWord.toLowerCase()) {
                        foundResult = value;
                        break;
                    }
                }
            }

            if (foundResult) {
                const newTranslation = (!translation || translation.trim() === '' || translation.trim() === '---') && foundResult.translation && foundResult.translation.trim()
                    ? foundResult.translation : translation;
                const newDefinition = (!definition || definition.trim() === '' || definition.trim() === '---') && foundResult.definition && foundResult.definition.trim()
                    ? foundResult.definition : definition;
                const newExampleSource = (!exampleSource || exampleSource.trim() === '' || exampleSource.trim() === '---') && foundResult.exampleSource && foundResult.exampleSource.trim()
                    ? foundResult.exampleSource : exampleSource;
                const newExampleTarget = (!exampleTarget || exampleTarget.trim() === '' || exampleTarget.trim() === '---') && foundResult.exampleTarget && foundResult.exampleTarget.trim()
                    ? foundResult.exampleTarget : exampleTarget;

                const newRow = `| ${this.escapeTableCell(num)} | ${this.escapeTableCell(sourceWord)} | ${this.escapeTableCell(newTranslation)} | ${this.escapeTableCell(newDefinition)} | ${this.escapeTableCell(newExampleSource)} | ${this.escapeTableCell(newExampleTarget)} |`;
                newRows.push(newRow);

                const updatedFields = [];
                if (newTranslation !== translation) updatedFields.push('translation');
                if (newDefinition !== definition) updatedFields.push('definition');
                if (newExampleSource !== exampleSource) updatedFields.push('example');
                if (newExampleTarget !== exampleTarget) updatedFields.push('translated example');

                if (updatedFields.length > 0) {
                    updatedCount++;
                }
            } else {
                const originalRow = `| ${this.escapeTableCell(num)} | ${this.escapeTableCell(sourceWord)} | ${this.escapeTableCell(translation)} | ${this.escapeTableCell(definition)} | ${this.escapeTableCell(exampleSource)} | ${this.escapeTableCell(exampleTarget)} |`;
                newRows.push(originalRow);
            }
        }

        if (updatedCount > 0) {
            await this.plugin.logEvent(`📊 Table updated: ${updatedCount} rows modified with partial results`, "info");
        }
        return newRows.join("\n");
    }

    private splitTableRow(row: string): string[] {
        const trimmed = row.trim();
        if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
            return [];
        }

        const content = trimmed.slice(1, -1).trim();
        return content.split('|').map(cell => cell.trim());
    }

    private escapeTableCell(text: string): string {
        if (!text) return '';
        let escaped = text.replace(/\|/g, '\\|');
        escaped = escaped.replace(/\n/g, ' ');
        return escaped.trim();
    }

    private isSeparatorRow(row: string): boolean {
        const trimmed = row.trim();
        if (!trimmed.startsWith('|')) return false;

        const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
        return cells.some(cell => /^:?-{3,}:?$/.test(cell));
    }

    private isHeaderRow(row: string): boolean {
        const cells = this.splitTableRow(row);
        if (cells.length === 0) return false;

        const firstCell = cells[0]?.toLowerCase().trim();
        const secondCell = cells[1]?.toLowerCase().trim();

        const headerIndicators = ['#', 'number', 'num', 'no.', 'word', 'source', 'original'];

        return headerIndicators.some(indicator =>
            firstCell?.includes(indicator) ||
            secondCell?.includes(indicator)
        ) || this.isSeparatorRow(row);
    }
    constructor(private plugin: VocabularyAnkiSyncPlugin) {
        this.rateLimiter = new AdvancedRateLimiter(() => {
            const desired = this.plugin.settings.requestsPerMinute;
            const cap = this.plugin.getMaxRequestsPerMinute();
            return Math.max(1, Math.min(desired, cap));
        });
        this.circuitBreaker = new CircuitBreaker('TranslationService');
        this.networkBackoff = new ExponentialBackoff();
    }

    async processWordsInBatches(words: string[], sourceLang: string, targetLang: string): Promise<Map<string, GroqTranslationResult>> {
        const allResults = new Map<string, GroqTranslationResult>();

        this.jsonErrorCount = 0;
        this.rateLimitErrorCount = 0;
        this.errorRetryCounts.clear();
        this.networkBackoff.reset();

        const useAdaptive = this.plugin.settings.smartAutoMode && this.plugin.settings.enableAdaptiveBatching;
        if (useAdaptive) {
            const initialSize = this.getSmartBatchSize();
            this.adaptiveBatchController = new AdaptiveBatchController(initialSize, 20);
            if (this.plugin.settings.logLevel === 'detailed') {
                await this.plugin.logEvent(`Smart Auto Mode: Adaptive batching enabled (starting: ${initialSize})`, "info");
            }
        }

        const uncached: string[] = [];
        for (const w of words) {
            const cached = this.plugin.getCachedResult(w);
            if (cached && this.isValidTranslation(cached)) {
                allResults.set(w, cached);
            } else {
                uncached.push(w);
            }
        }

        const prioritized = this.prioritizeWords(uncached);
        const batches = this.createOptimizedBatches(prioritized);
        const totalWords = uncached.length;
        const totalBatches = batches.length;
        let doneWords = allResults.size;

        if (this.plugin.settings.logLevel === 'detailed') {
            await this.plugin.logEvent(`Processing ${words.length} words (${totalWords} new, ${doneWords} from cache) in ${totalBatches} batches`, "info");
        }

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];

            try {
                await this.circuitBreaker.execute(async () => {
                    if (this.lastBackoffUntilTs > Date.now()) {
                        const waitMs = this.lastBackoffUntilTs - Date.now();
                        if (this.plugin.settings.logLevel === 'detailed') {
                            await this.plugin.logEvent(`Global backoff in effect, waiting ${Math.ceil(waitMs / 1000)}s`, 'warning');
                        }
                        await this.delay(waitMs);
                    }

                    if (this.plugin.isCancelRequested()) {
                        if (this.plugin.settings.logLevel === 'detailed') {
                            await this.plugin.logEvent('Cancellation requested - stopping batch processing', 'warning');
                        }
                        throw new Error('OPERATION_CANCELLED');
                    }

                    if (this.plugin.settings.enableRateLimiting) {
                        await this.rateLimiter.acquireSlot();
                    }


                    const batchResults = await this.processSingleBatchWithRetry(batch, sourceLang, targetLang);

                    for (const [word, result] of batchResults.entries()) {
                        allResults.set(word, result);
                        this.plugin.setCachedResult(word, result);
                    }

                    this.consecutiveNonModelFailures = 0;
                    this.plugin.recordUsageStats({ words: batch.length, ok: true });
                    this.plugin.operationSummaryManager.recordSuccess(batch.length);

                    try {
                        await this.savePartialResultsToTable(allResults, sourceLang, targetLang);
                        if (this.plugin.settings.logLevel === 'detailed') {
                            await this.plugin.logEvent(`✅ Saved partial results: ${allResults.size}/${words.length} words completed`, "success");
                        }
                    } catch (saveError) {
                        if (this.plugin.settings.logLevel === 'detailed') {
                            await this.plugin.logEvent(`⚠️ Could not save partial results: ${saveError}`, "warning");
                        }
                    }

                    try { await this.plugin.saveCacheStore(); } catch { }


                    doneWords = allResults.size;
                    this.plugin.updateProgress(i + 1, totalBatches, doneWords, words.length);

                    if (i < batches.length - 1) {
                        await this.delay(this.plugin.isMobileEnv ? 3000 : 2000);
                    }
                });

            } catch (error: any) {
                const errorCategory = ErrorClassifier.categorizeError(error);
                await this.plugin.logEvent(`Batch ${i + 1} failed: ${error.message} (Category: ${errorCategory})`, "error");
                this.plugin.recordUsageStats({ words: batch.length, ok: false });
                this.plugin.operationSummaryManager.recordFailure(error, batch.length);

                if (allResults.size > 0) {
                    try {
                        await this.savePartialResultsToTable(allResults, sourceLang, targetLang);
                        if (this.plugin.settings.logLevel === 'detailed') {
                            await this.plugin.logEvent(`💾 Saved ${allResults.size} partial results before failure`, "warning");
                        }
                    } catch (saveError) {
                        await this.plugin.logEvent(`❌ Failed to save partial results: ${saveError}`, "error");
                    }
                }

                const isModelError = errorCategory === ERROR_CATEGORIES.MODEL;
                const isThresholdAbort = error.message && (
                    error.message.includes('JSON_THRESHOLD') ||
                    error.message.includes('RATE_LIMIT_THRESHOLD')
                );

                const isMixedScriptError = error.message.includes('mixed-script validation') ||
                    (error.message.includes('All worker endpoints failed') && error.message.includes('mixed-script validation'));

                if (isMixedScriptError) {
                    if (this.plugin.settings.logLevel === 'detailed') {
                        await this.plugin.logEvent(`⚠️ Mixed-script validation failed for batch - skipping and continuing`, "warning");
                    }
                    batch.forEach(word => {
                        this.plugin.getFailedWordsInCurrentOperation().add(word.toLowerCase());
                    });
                    continue;
                }

                const isOperationWideFailure = errorCategory === ERROR_CATEGORIES.SERVER ||
                    error.message.includes('Circuit breaker') ||
                    (error.message.includes('All worker endpoints failed') && !isMixedScriptError);

                if (isModelError) {
                    await this.plugin.logEvent(`🚨 MODEL ERROR - Stopping all operations immediately`, "error");
                    this.plugin.operationSummaryManager.completeOperation('failed', `Model error: ${error.message}`);
                    throw error;
                }

                if (isThresholdAbort) {
                    const reason = error.message.includes('JSON_THRESHOLD')
                        ? 'Repeated JSON response errors (3 times)'
                        : 'Repeated rate-limit errors (2 times)';
                    await this.plugin.logEvent(`🔴 ABORT THRESHOLD: ${reason}.`, 'error');
                    this.plugin.operationSummaryManager.completeOperation('failed', `Threshold abort: ${reason}`);
                    throw error;
                }

                if (isOperationWideFailure) {
                    await this.plugin.logEvent(`🔴 OPERATION-WIDE FAILURE - Stopping all operations immediately`, "error");
                    this.plugin.operationSummaryManager.completeOperation('failed', `Infrastructure error: ${error.message}`);
                    throw error;
                }

                const policy = ErrorClassifier.getErrorPolicy(errorCategory);
                const currentRetryCount = this.errorRetryCounts.get(errorCategory) || 0;

                if (policy.retryable && currentRetryCount < policy.maxRetries) {
                    this.errorRetryCounts.set(errorCategory, currentRetryCount + 1);

                    if (errorCategory === ERROR_CATEGORIES.NETWORK) {
                        await this.networkBackoff.wait();
                        if (this.plugin.settings.logLevel === 'detailed') {
                            await this.plugin.logEvent(`Network error - retrying after ${this.networkBackoff.getCurrentDelay()}ms (attempt ${currentRetryCount + 1}/${policy.maxRetries})`, 'warning');
                        }
                    } else if (errorCategory === ERROR_CATEGORIES.RATE_LIMIT) {
                        const backoffMs = 5000 * policy.backoffMultiplier;
                        this.lastBackoffUntilTs = Math.max(this.lastBackoffUntilTs, Date.now() + backoffMs);
                        if (this.plugin.settings.logLevel === 'detailed') {
                            await this.plugin.logEvent(`Rate limit - waiting ${backoffMs}ms before retry`, 'warning');
                        }
                        await this.delay(backoffMs);
                    }

                    if (this.plugin.settings.logLevel === 'detailed') {
                        await this.plugin.logEvent(`Retrying batch ${i + 1} (${errorCategory})`, "info");
                    }
                    i--;
                    continue;
                }

                if (this.adaptiveBatchController) {
                    this.adaptiveBatchController.onFailure();
                }

                const cap = Math.max(1, this.plugin.settings.maxNonModelFailures ?? 3);
                this.consecutiveNonModelFailures++;
                if (this.consecutiveNonModelFailures >= cap) {
                    await this.plugin.logEvent(`🔴 NON-MODEL FAILURE CAP REACHED (${cap}). Aborting.`, 'error');
                    this.plugin.operationSummaryManager.completeOperation('failed', `Non-model failure limit reached (${this.consecutiveNonModelFailures} failures)`);
                    throw new Error('Non-model failure limit reached');
                }

                if (this.plugin.settings.logLevel === 'detailed') {
                    await this.plugin.logEvent(`🚫 Skipping failed batch ${i + 1}, continuing with next batches`, "info");
                }
            }
        }

        if (allResults.size > 0) {
            try {
                await this.savePartialResultsToTable(allResults, sourceLang, targetLang);
                if (this.plugin.settings.logLevel === 'detailed') {
                    await this.plugin.logEvent(`🎉 Final results saved: ${allResults.size}/${words.length} words completed`, "success");
                }
            } catch (finalError) {
                await this.plugin.logEvent(`❌ Final save failed: ${finalError}`, "error");
            }
        }

        await this.plugin.logEvent(`✅ Processing completed: ${allResults.size}/${words.length} words translated successfully`, "success");

        this.plugin.clearProgress();
        try { await this.plugin.saveCacheStore(); } catch { }
        return allResults;
    }
    private async processSingleBatchWithRetry(batch: string[], sourceLang: string, targetLang: string): Promise<Map<string, GroqTranslationResult>> {
        const cachedResults = new Map<string, GroqTranslationResult>();
        const uncachedWords: string[] = [];

        for (const word of batch) {
            const cached = this.plugin.getCachedResult(word);
            if (cached && this.isValidTranslation(cached)) {
                cachedResults.set(word, cached);
            } else {
                uncachedWords.push(word);
            }
        }

        if (uncachedWords.length === 0) {
            return cachedResults;
        }

        const newResults = await this.callCloudflareWorkerDirect(uncachedWords, sourceLang, targetLang);

        for (const [word, result] of newResults.entries()) {
            if (this.isValidTranslation(result)) {
                this.plugin.setCachedResult(word, result);
            }
        }

        return new Map([...cachedResults, ...newResults]);
    }
    private getSmartBatchSize(): number {
        const quality = this.plugin.settings.translationQuality;
        switch (quality) {
            case 'comprehensive': return 3;
            case 'professional': return 5;
            case 'standard': return 8;
            default: return 6;
        }
    }

    private createOptimizedBatches(words: string[]): string[][] {
        const batches: string[][] = [];
        const batchSize = this.adaptiveBatchController
            ? this.adaptiveBatchController.getBatchSize()
            : this.plugin.settings.batchSize;

        for (let i = 0; i < words.length; i += batchSize) {
            batches.push(words.slice(i, i + batchSize));
        }

        return batches;
    }

    private prioritizeWords(words: string[]): string[] {
        const score = (w: string) => {
            const hasNonAscii = /[^\x00-\x7F]/.test(w) ? 1 : 0;
            return hasNonAscii * 1000 + Math.min(100, w.length);
        };
        return [...words].sort((a, b) => score(b) - score(a));
    }

    private async processSmallerBatches(words: string[], sourceLang: string, targetLang: string): Promise<Map<string, GroqTranslationResult>> {
        const results = new Map<string, GroqTranslationResult>();
        const suggested = this.adaptiveBatchController ? Math.max(2, Math.min(4, Math.floor(this.adaptiveBatchController.getBatchSize() / 2) || 2)) : 3;
        const miniSize = Math.max(2, Math.min(4, suggested));
        for (let idx = 0; idx < words.length; idx += miniSize) {
            const chunk = words.slice(idx, idx + miniSize);
            if (this.plugin.isCancelRequested()) {
                await this.plugin.logEvent('Cancellation requested - stopping smaller batch processing', 'warning');
                break;
            }
            try {
                await this.delay(this.plugin.isMobileEnv ? 1200 : 800);
                const chunkResult = await this.processSingleBatchWithRetry(chunk, sourceLang, targetLang);
                chunkResult.forEach((result, w) => results.set(w, result));
            } catch (error: any) {
                const errorCategory = ErrorClassifier.categorizeError(error);

                if (errorCategory !== ERROR_CATEGORIES.MODEL &&
                    !error.message.includes('RATE_LIMIT_THRESHOLD') &&
                    !error.message.includes('JSON_THRESHOLD') &&
                    errorCategory !== ERROR_CATEGORIES.SERVER) {
                    chunk.forEach(word => {
                        this.plugin.getFailedWordsInCurrentOperation().add(word.toLowerCase());
                    });
                }

                if (errorCategory === ERROR_CATEGORIES.MODEL) {
                    throw error;
                }

                if (error.message && (error.message.includes('RATE_LIMIT_THRESHOLD') || error.message.includes('JSON_THRESHOLD'))) {
                    throw error;
                }

                if (errorCategory === ERROR_CATEGORIES.SERVER ||
                    error.message.includes('Circuit breaker') ||
                    error.message.includes('All worker endpoints failed')) {
                    throw error;
                }

                const label = chunk.length === 1 ? `"${chunk[0]}"` : `[${chunk.join(', ')}]`;
                await this.plugin.logEvent(`Failed to translate ${label} (${errorCategory})`, 'error');

                if (errorCategory === ERROR_CATEGORIES.RATE_LIMIT) {
                    const backoffMs = this.plugin.isMobileEnv ? 8000 : 5000;
                    this.lastBackoffUntilTs = Math.max(this.lastBackoffUntilTs, Date.now() + backoffMs);
                    await this.delay(backoffMs);
                }
            }
        }
        return results;
    }

    private async callCloudflareWorkerDirect(words: string[], sourceLang: string, targetLang: string): Promise<Map<string, GroqTranslationResult>> {
        await this.plugin.logEvent(`Sending ${words.length} word(s) to Cloudflare Worker`, 'info');
        const requestBody = {
            words,
            sourceLang: sourceLang,
            targetLang: targetLang,
            model: this.plugin.settings.groqModel,
            settings: {
                translationQuality: this.plugin.settings.translationQuality,
                learnerLevel: this.plugin.settings.learnerLevel,
                smartAutoMode: this.plugin.settings.smartAutoMode,
                meaningsCount: this.plugin.settings.meaningsCount,
                useJSONFormat: this.plugin.settings.useJSONFormat,
                limitDefinitionLength: this.plugin.settings.limitDefinitionLength,
                simplifyExamplesForBeginners: this.plugin.settings.simplifyExamplesForBeginners,
                addNuanceForAdvanced: this.plugin.settings.addNuanceForAdvanced,
                qualityScoreThreshold: this.plugin.settings.qualityScoreThreshold,
                enableConsensus: this.plugin.settings.enableConsensus,
                consensusTriggerThreshold: this.plugin.settings.consensusTriggerThreshold,
                consensusMaxModels: this.plugin.settings.consensusMaxModels,
                consensusBudgetPerRun: this.plugin.settings.consensusBudgetPerRun,
                consensusStrategy: this.plugin.settings.consensusStrategy
            }
        };

        try {
            const data = await this.postToWorkerWithFailover(requestBody);

            const results = new Map<string, GroqTranslationResult>();
            if (data && data.success && data.translations) {
                for (const [word, value] of Object.entries<any>(data.translations)) {
                    results.set(word, {
                        translation: (value as any).translation,
                        definition: (value as any).definition,
                        exampleSource: (value as any).exampleSource,
                        exampleTarget: (value as any).exampleTarget
                    });
                }
            }

            if (results.size === 0) {
                throw new Error('No translations returned from Cloudflare Worker');
            }

            await this.plugin.logEvent(`Cloudflare Worker returned ${results.size} translation(s)`, 'success');
            return results;

        } catch (error: any) {
            const errorCategory = ErrorClassifier.categorizeError(error);

            await this.plugin.logEvent(`Cloudflare Worker error: ${error.message} (Category: ${errorCategory})`, 'error');

            if (errorCategory === ERROR_CATEGORIES.CAPACITY || errorCategory === ERROR_CATEGORIES.MODEL_CAPACITY) {
                await this.plugin.logEvent(`Model capacity issue detected - will follow smart retry policy`, 'warning');
            }

            throw error;
        }
    }

    private async postToWorkerWithFailover(body: any): Promise<any> {
        const config = this.plugin.settings.remoteConfig;
        if (!config) {
            throw new Error('Remote configuration not loaded');
        }

        const normalizeUrl = (u: string) => {
            try { new URL(u); return u; } catch { return u; }
        };
        const isValidHttps = (u: any) => {
            if (!u || typeof u !== 'string') return false;
            try {
                const x = new URL(u);
                return x.protocol === 'https:';
            } catch { return false; }
        };

        const raw = [config.endpoints.primary, ...config.endpoints.backups].filter(Boolean);
        const filtered = raw
            .map(normalizeUrl)
            .filter(isValidHttps);
        const urls: string[] = [];
        for (const u of filtered) { if (!urls.includes(u)) urls.push(u); }

        const errors: { url: string; message: string; category: ErrorCategory }[] = [];

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            try {
                let attemptedJsonFallback = false;
                let attemptedRateLimitRetry = false;
                let currentBody = { ...(body || {}) };

                const doRequest = async (): Promise<{ response: Response, text: string }> => {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(currentBody)
                    });
                    const responseText = await response.text();
                    return { response, text: responseText };
                };

                let { response: res, text: responseText } = await doRequest();

                if (!res.ok) {
                    let errorData;
                    try {
                        errorData = JSON.parse(responseText);
                    } catch {
                        throw new Error(`HTTP ${res.status}: ${responseText}`);
                    }

                    const error = new Error(errorData?.error || `HTTP ${res.status}`);
                    (error as any).status = res.status;

                    const errorCategory = ErrorClassifier.categorizeError(error);

                    if (errorCategory === ERROR_CATEGORIES.CAPACITY || errorCategory === ERROR_CATEGORIES.MODEL_CAPACITY) {
                        await this.plugin.logEvent(`Capacity error from ${url} - ${errorData?.error || 'Model over capacity'}`, 'warning');
                        throw new Error(errorData?.error || `HTTP ${res.status}: ${responseText}`);
                    }

                    if (errorData?.errorCategory === ERROR_CATEGORIES.MODEL) {
                        await this.plugin.logEvent(`Model "${this.plugin.settings.groqModel}" is not available (worker). Stopping operation.`, 'error');
                        throw new Error(`Model Not Available: ${errorData.error || 'The selected model is not accessible'}`);
                    }

                    if (res.status === 400 && errorData?.errorCategory === ERROR_CATEGORIES.JSON) {
                        this.jsonErrorCount++;
                        if (this.jsonErrorCount >= 2) {
                            await this.plugin.logEvent('JSON errors reached threshold (2). Stopping operation.', 'error');
                            throw new Error('JSON_THRESHOLD');
                        }
                        if (!attemptedJsonFallback && currentBody && currentBody.settings && currentBody.settings.useJSONFormat !== false) {
                            attemptedJsonFallback = true;
                            try {
                                await this.plugin.logEvent('JSON validate failed → retrying without JSON response_format for this attempt', 'warning');
                                currentBody = { ...currentBody, settings: { ...(currentBody.settings || {}), useJSONFormat: false } };
                                const retryResult = await doRequest();
                                res = retryResult.response;
                                responseText = retryResult.text;
                                if (!res.ok) {
                                    try { errorData = JSON.parse(responseText); } catch { throw new Error(`HTTP ${res.status}: ${responseText}`); }
                                } else {
                                    const data = JSON.parse(responseText);
                                    if (i > 0 && this.plugin.settings.autoEndpointSwitch) {
                                        await this.updateEndpointConfig(url, i, urls);
                                    }
                                    return data;
                                }
                            } catch { }
                        }
                    }

                    if (res.status === 429 && !attemptedRateLimitRetry) {
                        this.rateLimitErrorCount++;
                        if (this.rateLimitErrorCount >= 1) {
                            await this.plugin.logEvent('Rate limit errors reached threshold (1). Stopping operation.', 'error');
                            throw new Error('RATE_LIMIT_THRESHOLD');
                        }
                        attemptedRateLimitRetry = true;
                        try {
                            let waitMs = 2000;
                            const textMsg = JSON.stringify(errorData) || '';
                            const m = textMsg.match(/try again in\s+([\d.]+)s/i);
                            if (m) {
                                const sec = parseFloat(m[1]);
                                if (!Number.isNaN(sec)) waitMs = Math.max(500, Math.min(10000, Math.round(sec * 1000)));
                            }
                            const oldRpm = this.plugin.settings.requestsPerMinute | 0;
                            const newRpm = Math.max(1, Math.floor(oldRpm * 0.8));
                            if (newRpm < oldRpm) {
                                this.plugin.settings.requestsPerMinute = newRpm;
                                await this.plugin.saveSettings();
                                await this.plugin.logEvent(`Rate limit signal: reducing RPM ${oldRpm} → ${newRpm}; waiting ~${Math.round(waitMs / 1000)}s`, 'warning');
                            } else {
                                await this.plugin.logEvent(`Rate limit signal: waiting ~${Math.round(waitMs / 1000)}s`, 'warning');
                            }
                            await new Promise(r => setTimeout(r, waitMs));
                            const retryResult = await doRequest();
                            res = retryResult.response;
                            responseText = retryResult.text;
                            if (!res.ok) {
                                try { errorData = JSON.parse(responseText); } catch { throw new Error(`HTTP ${res.status}: ${responseText}`); }
                            } else {
                                const data = JSON.parse(responseText);
                                if (i > 0 && this.plugin.settings.autoEndpointSwitch) {
                                    await this.updateEndpointConfig(url, i, urls);
                                }
                                return data;
                            }
                        } catch { }
                    }

                    if (res.status === 404 && errorData?.errorCategory === ERROR_CATEGORIES.MODEL) {
                        await this.plugin.logEvent(`Model "${this.plugin.settings.groqModel}" is not available. Stopping operation immediately.`, 'error');
                        throw new Error(`Model Not Available: ${errorData.error || 'The selected model is not accessible'}`);
                    }

                    throw new Error(`HTTP ${res.status}: ${errorData?.error || responseText}`);
                }

                const data = JSON.parse(responseText);
                if (i > 0 && this.plugin.settings.autoEndpointSwitch) {
                    await this.updateEndpointConfig(url, i, urls);
                }
                return data;

            } catch (e: any) {
                const msg = (e?.message || String(e));
                const category = ErrorClassifier.categorizeError(e);
                errors.push({ url, message: msg, category });
                await this.plugin.logEvent(`Endpoint failed (${url}): ${msg} (${category})`, 'warning');

                if (
                    category === ERROR_CATEGORIES.MODEL ||
                    category === ERROR_CATEGORIES.CAPACITY ||
                    category === ERROR_CATEGORIES.MODEL_CAPACITY ||
                    msg.includes('RATE_LIMIT_THRESHOLD') ||
                    msg.includes('JSON_THRESHOLD')
                ) {
                    throw e;
                }
                continue;
            }
        }

        const summary = errors.map((er, idx) => `${idx + 1}) ${er.url} -> ${er.message} [${er.category}]`).join('\n');
        await this.plugin.logEvent(`All worker endpoints failed. Summary:\n${summary}`, 'error');
        throw new Error(`All worker endpoints failed`);
    }

    private async updateEndpointConfig(successfulUrl: string, currentIndex: number, allUrls: string[]): Promise<void> {
        const normalizeUrl = (u: string) => {
            try { new URL(u); return u; } catch { return u; }
        };
        const isValidHttps = (u: any) => {
            if (!u || typeof u !== 'string') return false;
            try {
                const x = new URL(u);
                return x.protocol === 'https:';
            } catch { return false; }
        };

        const prevActiveRaw = this.plugin.settings.activeWorkerUrl;
        const prevActive = normalizeUrl(prevActiveRaw);
        const originalBackups = (this.plugin.settings.backupWorkerUrls || [])
            .map(normalizeUrl)
            .filter(isValidHttps);

        const k = currentIndex - 1;
        const rotated = [...originalBackups.slice(k + 1), ...originalBackups.slice(0, k), prevActive]
            .filter(u => u && u !== successfulUrl);

        const dedup: string[] = [];
        for (const u of rotated) { if (!dedup.includes(u)) dedup.push(u); }

        this.plugin.settings.activeWorkerUrl = successfulUrl;
        this.plugin.settings.backupWorkerUrls = dedup.slice(0, 3);
        await this.plugin.saveSettings();
        await this.plugin.logEvent(`Failover: active => ${successfulUrl}; backups => [${this.plugin.settings.backupWorkerUrls.join(', ')}]`, 'warning');
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

class ProgressModal extends Modal {
    private progressBar: HTMLDivElement;
    private statusEl: HTMLParagraphElement;
    private currentBatchEl: HTMLParagraphElement;
    private statsEl: HTMLParagraphElement;
    private cancelButton: HTMLButtonElement;

    constructor(app: App, private plugin: VocabularyAnkiSyncPlugin) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('vocabulary-translation-progress-modal');

        const title = contentEl.createEl('h2', { text: 'Translating Vocabulary' });
        title.style.textAlign = 'center';

        const progressContainer = contentEl.createDiv({ cls: 'progress-container' });
        this.progressBar = progressContainer.createEl('div', { cls: 'progress-bar' });
        this.progressBar.style.width = '0%';
        this.progressBar.style.height = '20px';
        this.progressBar.style.backgroundColor = 'var(--interactive-accent)';
        this.progressBar.style.borderRadius = '10px';
        this.progressBar.style.transition = 'width 0.3s ease';

        this.statusEl = contentEl.createEl('p', { text: 'Initializing...' });
        this.statusEl.style.textAlign = 'center';
        this.statusEl.style.margin = '10px 0';

        this.currentBatchEl = contentEl.createEl('p', { text: '' });
        this.currentBatchEl.style.textAlign = 'center';
        this.currentBatchEl.style.fontSize = '12px';
        this.currentBatchEl.style.color = 'var(--text-muted)';

        this.statsEl = contentEl.createEl('p', { text: '' });
        this.statsEl.style.textAlign = 'center';
        this.statsEl.style.fontSize = '11px';
        this.statsEl.style.color = 'var(--text-faint)';

        if (this.plugin.settings.enableCancelButton) {
            this.cancelButton = contentEl.createEl('button', { text: 'Cancel Translation' });
            this.cancelButton.style.display = 'block';
            this.cancelButton.style.margin = '20px auto';
            this.cancelButton.style.padding = '8px 16px';
            this.cancelButton.style.backgroundColor = 'var(--background-modifier-error)';
            this.cancelButton.style.color = 'white';
            this.cancelButton.style.border = 'none';
            this.cancelButton.style.borderRadius = '4px';
            this.cancelButton.style.cursor = 'pointer';

            this.cancelButton.addEventListener('click', () => {
                this.plugin.requestCancel();
                this.cancelButton.disabled = true;
                this.cancelButton.textContent = 'Cancelling...';
            });
        }
    }

    updateProgress(progress: number, statusText: string, batchText: string, statsText: string) {
        this.progressBar.style.width = `${progress}%`;
        this.statusEl.textContent = statusText;
        this.currentBatchEl.textContent = batchText;
        this.statsEl.textContent = statsText;
    }
}

export default class VocabularyAnkiSyncPlugin extends Plugin {
    settings: MyPluginSettings;
    private translationCache = new Map<string, GroqTranslationResult>();
    private cacheStore: Record<string, { ts: number; data: GroqTranslationResult }> = {};
    private batchManager: ProfessionalBatchManager;
    private performanceUpdateTimer: number | null = null;
    private autoSyncEventRef: any = null;
    private isProcessing: boolean = false;
    private currentOperationId: string = "";
    private statusBarEl: HTMLElement | null = null;
    private cancelRequested: boolean = false;
    private lastProgressNoticeTs: number = 0;
    public isMobileEnv: boolean = false;
    private logFileEnsuring: Promise<TFile | null> | null = null;
    private usageStats: UsageStats = { totalWordsProcessed: 0, successfulBatches: 0, failedBatches: 0, totalBatches: 0, totalBatchSize: 0 };
    private cacheCleanupTimer: number | null = null;
    private progressModal: ProgressModal | null = null;
    public operationSummaryManager: OperationSummaryManager;
    private failedWordsInCurrentOperation: Set<string> = new Set();

    getCurrentResultsCount(): number {
        return this.batchManager ? (this.batchManager as any).getCurrentResultsCount?.() || 0 : 0;
    }

    async onload() {
        await this.loadSettings();
        this.operationSummaryManager = new OperationSummaryManager();
        this.batchManager = new ProfessionalBatchManager(this);

        try {
            const ua = (navigator && (navigator as any).userAgent) || "";
            this.isMobileEnv = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
        } catch { this.isMobileEnv = false; }

        this.addStyle();
        try { this.statusBarEl = (this as any).addStatusBarItem?.() || null; } catch { }
        if (this.statusBarEl) {
            this.statusBarEl.addEventListener('click', () => {
                if (this.settings.enableCancelButton && this.isProcessing) {
                    this.requestCancel();
                    new Notice('Cancelling current operation...');
                }
            });
        }

        const ribbonIconEl = this.addRibbonIcon('languages', 'Vocabulary AnkiSync', (evt: MouseEvent) => {
            this.showRibbonMenu(evt);
        });
        try {
            (ribbonIconEl as HTMLElement).style.order = String(this.settings.ribbonOrder ?? 9999);
            window.setTimeout(() => {
                const sideCls = this.settings.ribbonSide === 'right' ? '.workspace-ribbon.mod-right' : '.workspace-ribbon.mod-left';
                const ribbonActions = document.querySelector(`${sideCls} .side-dock-actions`);
                if (ribbonActions && ribbonIconEl && ribbonIconEl.parentElement === ribbonActions) {
                    ribbonActions.appendChild(ribbonIconEl);
                }
            }, 0);
        } catch { }

        this.addCommand({
            id: "sync-anki-vocab",
            name: "Sync Vocabulary with Anki",
            callback: async () => {
                if (this.isProcessing) {
                    new Notice("Another operation is in progress...");
                    return;
                }
                await this.startNewOperation("anki-sync");
                await this.syncWithAnki();
            }
        });

        this.addCommand({
            id: "process-words-file-advanced",
            name: "Process Words File (Professional Translation)",
            callback: async () => {
                if (this.isProcessing) {
                    new Notice("Another operation is in progress...");
                    return;
                }
                await this.startNewOperation("translation");
                await this.processWordsFileAdvanced();
            }
        });

        this.addCommand({
            id: "clear-cache",
            name: "Clear AI Memory",
            callback: async () => {
                await this.clearCache();
            }
        });

        this.addCommand({
            id: "test-connection",
            name: "Test Translation Service",
            callback: async () => {
                await this.testGroqConnection();
            }
        });

        this.addCommand({
            id: "show-operation-summary",
            name: "Show Operation Summary",
            callback: async () => {
                const summary = this.operationSummaryManager.getCurrentSummary();
                if (summary) {
                    const report = this.operationSummaryManager.generateSummaryReport(summary);
                    new Notice(report, 10000);
                } else {
                    new Notice("No operation in progress");
                }
            }
        });

        this.addCommand({
            id: "show-update-and-endpoints",
            name: "Show Worker Status & Updates",
            callback: async () => {
                await this.showUpdateAndEndpoints();
            }
        });

        this.addCommand({
            id: "reload-remote-config",
            name: "Reload Remote Configuration",
            callback: async () => {
                await this.loadRemoteConfig();
            }
        });

        this.addSettingTab(new VocabularyAnkiSyncSettingTab(this.app, this));

        this.setupAutoSync();
        this.setupCacheCleanup();

        await this.ensureLogFile();
        await this.logEvent("Plugin loaded successfully", "success");

        await this.loadRemoteConfig();

        try {
            const manifestVersion = (this as any)?.manifest?.version as string | undefined;
            if (manifestVersion && !this.settings.cachedServerUpdateVersion) {
                this.settings.cachedServerUpdateVersion = manifestVersion;
                await this.saveSettings();
            }
        } catch { }
        this.checkCachedUpdateOnStartup();
    }

    async loadRemoteConfig(): Promise<void> {
        try {
            await this.logEvent("Loading remote configuration from GitHub...", "info");
            const config = await RemoteConfigManager.loadConfig();
            this.settings.remoteConfig = config;

            this.settings.activeWorkerUrl = config.endpoints.primary;
            this.settings.backupWorkerUrls = config.endpoints.backups;
            this.settings.availableModels = config.models.options;
            this.settings.highLimitModels = config.models.high_limit;

            if (config.models.consensus_models && config.models.consensus_models.length > 0) {
                this.settings.consensusModels = config.models.consensus_models;
            }

            const availableModels = Object.keys(config.models.options);
            if (availableModels.length > 0) {
                const currentModel = this.settings.groqModel;
                if (!availableModels.includes(currentModel)) {
                    this.settings.groqModel = availableModels[0];
                    this.settings.activeModelIndex = 0;
                    await this.logEvent(`Updated model selection to: ${availableModels[0]}`, "info");
                }
            }

            await this.checkForPluginUpdates(config);
            await this.saveSettings();
            await this.logEvent("Remote configuration loaded successfully from GitHub", "success");
            new Notice("✅ Remote configuration updated from GitHub");
        } catch (error) {
            await this.logEvent(`Failed to load remote configuration: ${error}`, "error");
            new Notice("⚠️ Using default configuration");
        }
    }

    async onunload() {
        this.translationCache.clear();
        this.cacheStore = {};
        if (this.performanceUpdateTimer) {
            clearTimeout(this.performanceUpdateTimer);
        }
        if (this.autoSyncEventRef) {
            this.app.vault.offref(this.autoSyncEventRef);
        }
        if (this.cacheCleanupTimer) {
            clearInterval(this.cacheCleanupTimer as any);
            this.cacheCleanupTimer = null;
        }
        try { await this.saveCacheStore(); } catch { }
        await this.logEvent("Plugin unloaded", "info");
    }

    private async checkForPluginUpdates(config: RemoteConfig) {
        try {
            if (!this.settings.enableUpdateNotifications) {
                await this.logEvent("Update notifications are disabled - skipping user notifications", "info");
                return;
            }

            if (!config.update_info?.version) {
                await this.logEvent("No version info in remote config", "warning");
                return;
            }

            const currentVersion = (this as any).manifest?.version;
            const latestVersion = config.update_info.version;

            if (!currentVersion) {
                await this.logEvent("Cannot read current plugin version", "error");
                return;
            }

            await this.logEvent(`🔍 Version Check: Current v${currentVersion} vs Latest v${latestVersion}`, "info");

            const comparison = this.compareVersions(currentVersion, latestVersion);

            if (comparison < 0) {
                await this.notifyNewVersion(currentVersion, latestVersion, config.update_info);
            } else if (comparison === 0) {
                await this.logEvent("✅ Plugin is up to date", "success");
            } else {
                await this.logEvent("⚠️ Development mode: Plugin version is newer than config version", "warning");
            }
        } catch (error) {
            await this.logEvent(`Version check error: ${error}`, "error");
        }
    }

    private compareVersions(a: string, b: string): number {
        const aParts = a.split('.').map(Number);
        const bParts = b.split('.').map(Number);

        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aVal = aParts[i] || 0;
            const bVal = bParts[i] || 0;
            if (aVal > bVal) return 1;
            if (aVal < bVal) return -1;
        }
        return 0;
    }

    private async notifyNewVersion(current: string, latest: string, updateInfo: any) {
        const message = `🔄 Plugin Update Available! 
Current: v${current} → Latest: v${latest}
${updateInfo.message || ''}`;

        new Notice(message, 10000);
        await this.logEvent(`🚀 UPDATE AVAILABLE: v${current} → v${latest} - ${updateInfo.message}`, "info");

        if (updateInfo.critical) {
            new Notice(`🚨 CRITICAL UPDATE: ${updateInfo.message}`, 15000);
        }
    }

    private checkCachedUpdateOnStartup(): void {
        try {
            if (!this.settings.enableUpdateNotifications) return;
            const cached = this.settings.cachedServerUpdateVersion;
            const currentVersion = (this as any)?.manifest?.version as string | undefined;
            if (!cached || !currentVersion) return;
            const cmp = this.compareVersions(currentVersion, cached);
            if (cmp < 0) {
                const pluginName = (this as any)?.manifest?.name || 'Plugin';
                new Notice(`🔔 New plugin update for ${pluginName} available: v${cached}`, 5000);
            }
        } catch { }
    }

    async testAnkiConnectDetailed(): Promise<void> {
        try {
            const body = { action: 'version', version: 6 };
            const res = await fetch(`http://127.0.0.1:${this.settings.ankiConnectPort}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: this.getTimeoutSignal(5000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const msg = `✅ AnkiConnect OK, version: ${data.result}`;
            await this.logEvent(msg, 'success');
            new Notice(msg);
        } catch (e: any) {
            const em = `❌ AnkiConnect test failed: ${e.message}`;
            await this.logEvent(em, 'error');
            new Notice(em);
        }
    }

    updateProgress(doneBatches: number, totalBatches: number, doneWords: number, totalWords: number) {
        if (!this.statusBarEl) return;
        const percent = totalWords > 0 ? Math.floor((doneWords / totalWords) * 100) : 0;
        const cancelHint = this.settings.enableCancelButton ? ' • Click to cancel' : '';
        (this.statusBarEl as any).setText?.(`AI Translate: ${doneBatches}/${totalBatches} batches • ${doneWords}/${totalWords} words (${percent}%)${cancelHint}`);
        if (this.settings.showProgressDialog) {
            const now = Date.now();
            const minGap = this.isMobileEnv ? 7000 : 5000;
            if (now - this.lastProgressNoticeTs > minGap) {
                this.lastProgressNoticeTs = now;
                new Notice(`AI Translate: ${doneBatches}/${totalBatches} • ${doneWords}/${totalWords} (${percent}%)`);
            }
        }
    }

    clearProgress() {
        if (!this.statusBarEl) return;
        (this.statusBarEl as any).setText?.("");
        this.resetCancel();
        if (this.progressModal) {
            this.progressModal.close();
            this.progressModal = null;
        }
    }

    requestCancel() { this.cancelRequested = true; }
    resetCancel() { this.cancelRequested = false; }
    isCancelRequested() { return this.cancelRequested; }

    getFailedWordsInCurrentOperation(): Set<string> {
        return this.failedWordsInCurrentOperation;
    }

    getCachedResult(word: string): GroqTranslationResult | undefined {
        const key = word.toLowerCase();
        const entry = this.cacheStore[key];
        if (!entry) return undefined;

        const ttlMs = (this.settings.cacheTTLHours ?? 24) * 3600_000;
        if (Date.now() - entry.ts > ttlMs) {
            delete this.cacheStore[key];
            return undefined;
        }

        if (this.isEmptyTranslation(entry.data)) {
            return undefined;
        }

        return entry.data;
    }

    private isEmptyTranslation(result: GroqTranslationResult): boolean {
        return (!result.translation || result.translation.trim() === '') &&
            (!result.definition || result.definition.trim() === '') &&
            (!result.exampleSource || result.exampleSource.trim() === '') &&
            (!result.exampleTarget || result.exampleTarget.trim() === '');
    }

    setCachedResult(word: string, data: GroqTranslationResult) {
        const key = word.toLowerCase();
        this.cacheStore[key] = { ts: Date.now(), data };
    }

    recordUsageStats(update: { words: number; ok: boolean }) {
        const words = Math.max(0, update.words | 0);
        this.usageStats.totalWordsProcessed += words;
        this.usageStats.totalBatches += 1;
        this.usageStats.totalBatchSize += words;
        if (update.ok) this.usageStats.successfulBatches += 1; else this.usageStats.failedBatches += 1;
    }

    getUsageStats(): { totals: UsageStats; avgBatchSize: number; successRate: number } {
        const totals = this.usageStats;
        const avgBatchSize = totals.totalBatches > 0 ? Math.round((totals.totalBatchSize / totals.totalBatches) * 10) / 10 : 0;
        const successRate = totals.totalBatches > 0 ? Math.round((totals.successfulBatches / totals.totalBatches) * 100) : 0;
        return { totals, avgBatchSize, successRate };
    }

    private setupCacheCleanup(): void {
        try {
            if (this.cacheCleanupTimer) { clearInterval(this.cacheCleanupTimer as any); }
            this.cacheCleanupTimer = window.setInterval(async () => {
                try {
                    const now = Date.now();
                    const ttlMs = (this.settings.cacheTTLHours ?? 24) * 3600_000;
                    let removed = 0;
                    for (const key of Object.keys(this.cacheStore)) {
                        const entry = this.cacheStore[key];
                        if (!entry || now - entry.ts > ttlMs) { delete this.cacheStore[key]; removed++; }
                    }
                    if (removed > 0) {
                        await this.saveCacheStore();
                        await this.logEvent(`Cache cleanup: removed ${removed} expired item(s)`, 'info');
                    }
                } catch { }
            }, 3600_000);
        } catch { }
    }

    async saveCacheStore() {
        const data = await this.loadData() || {};
        (data as any).cacheStore = this.cacheStore;
        (data as any).usageStats = this.usageStats;
        await this.saveData(data);
    }

    private showRibbonMenu(evt: MouseEvent) {
        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle("Sync with Anki")
                .setIcon("sync")
                .onClick(async () => {
                    if (this.isProcessing) {
                        new Notice("Another operation is in progress...");
                        return;
                    }
                    await this.startNewOperation("anki-sync");
                    await this.syncWithAnki();
                });
        });

        menu.addItem((item) => {
            item.setTitle("Process Words (AI Translation)")
                .setIcon("brain")
                .onClick(async () => {
                    if (this.isProcessing) {
                        new Notice("Another operation is in progress...");
                        return;
                    }
                    await this.startNewOperation("translation");
                    await this.processWordsFileAdvanced();
                });
        });

        menu.addItem((item) => {
            item.setTitle("Clear AI Memory")
                .setIcon("trash")
                .onClick(async () => {
                    await this.clearCache();
                });
        });

        menu.addItem((item) => {
            item.setTitle("Reload Remote Config")
                .setIcon("refresh-cw")
                .onClick(async () => {
                    await this.loadRemoteConfig();
                });
        });

        menu.addItem((item) => {
            item.setTitle("Cancel Current Operation")
                .setIcon("square")
                .onClick(async () => {
                    if (this.isProcessing) {
                        this.requestCancel();
                        new Notice("Cancelling current operation...");
                    } else {
                        new Notice("No operation in progress");
                    }
                });
        });

        menu.addItem((item) => {
            item.setTitle("Show Worker Status & Updates")
                .setIcon("info")
                .onClick(async () => {
                    await this.showUpdateAndEndpoints();
                });
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle("Open Settings")
                .setIcon("settings")
                .onClick(() => {
                    (this.app as any).setting.open();
                    (this.app as any).setting.openTabById("vocabulary-anki-sync");
                });
        });

        menu.showAtMouseEvent(evt);
    }

    getMaxRequestsPerMinute(): number {
        const highLimitModels = this.settings.highLimitModels || [];
        if (highLimitModels.includes(this.settings.groqModel)) {
            return 60;
        }
        return 30;
    }

    getCurrentMaxRequests(): number {
        return this.getMaxRequestsPerMinute();
    }

    isHighLimitModel(): boolean {
        const highLimitModels = this.settings.highLimitModels || [];
        return highLimitModels.includes(this.settings.groqModel);
    }

    private addStyle() {
        const style = document.createElement('style');
        style.textContent = `
            .vocabulary-sync-setting-section {
                margin-bottom: 30px;
                padding: 20px;
                border: 1px solid var(--background-modifier-border);
                border-radius: 8px;
                background: var(--background-secondary);
            }

            .vocabulary-sync-info-box {
                background: var(--background-primary-alt);
                padding: 15px;
                border-radius: 6px;
                margin-top: 15px;
                border-left: 4px solid var(--interactive-accent);
            }

            .vocabulary-sync-model-option {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .vocabulary-sync-slider-container {
                display: flex;
                align-items: center;
                gap: 15px;
                width: 100%;
            }

            .vocabulary-sync-slider-value {
                min-width: 30px;
                font-weight: bold;
                color: var(--text-accent);
            }

            .vocabulary-sync-performance-stats {
                background: var(--background-primary-alt);
                padding: 15px;
                border-radius: 6px;
                margin-top: 15px;
                border: 1px solid var(--interactive-accent);
            }

            .vocabulary-sync-performance-update {
                animation: pulse 0.5s ease-in-out;
            }

            .vocabulary-sync-command-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
                margin-top: 15px;
            }

            .vocabulary-sync-command-item {
                background: var(--background-primary);
                padding: 15px;
                border-radius: 6px;
                border: 1px solid var(--background-modifier-border);
            }

            .vocabulary-sync-settings-header {
                text-align: center;
                margin-bottom: 30px;
                padding: 20px 0;
                border-bottom: 1px solid var(--background-modifier-border);
            }

            .vocabulary-sync-language-info {
                background: var(--background-primary-alt);
                padding: 15px;
                border-radius: 6px;
                margin-top: 15px;
                border-left: 4px solid var(--interactive-accent);
                transition: all 0.3s ease;
            }

            .vocabulary-sync-high-limit-badge {
                background: var(--color-green);
                color: white;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 0.8em;
                font-weight: bold;
                margin-left: 8px;
            }

            .vocabulary-sync-standard-badge {
                background: var(--color-blue);
                color: white;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 0.8em;
                font-weight: bold;
                margin-left: 8px;
            }

            .vocabulary-sync-support-section {
                background: linear-gradient(135deg, var(--background-primary) 0%, var(--background-modifier-hover) 100%);
                border-left: 4px solid var(--interactive-accent);
            }

            .vocabulary-sync-support-section .setting-item {
                border-bottom: 1px solid var(--background-modifier-border);
                padding: 15px 0;
            }

            .vocabulary-sync-support-section .setting-item:last-child {
                border-bottom: none;
            }

            .vocabulary-sync-solidarity-message {
                text-align: center;
                padding: 20px;
                margin-top: 30px;
                background: linear-gradient(135deg, #000000 0%, #007a3d 50%, #ffffff 100%);
                border-radius: 8px;
                border: 2px solid #ce1126;
                color: white;
            }

            .vocabulary-sync-solidarity-message h3 {
                color: white !important;
                margin: 0 0 10px 0;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
            }

            .vocabulary-sync-solidarity-message p {
                margin: 5px 0;
                opacity: 0.9;
            }

            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.02); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    }

    private setupAutoSync() {
        if (this.autoSyncEventRef) {
            this.app.vault.offref(this.autoSyncEventRef);
            this.autoSyncEventRef = null;
        }

        if (this.settings.autoSync) {
            this.autoSyncEventRef = this.app.vault.on('modify', async (file) => {
                if (file instanceof TFile &&
                    file.path === this.settings.filePath &&
                    !this.isProcessing) {

                    try {
                        await this.app.vault.read(file);
                        await this.startNewOperation("auto-sync");
                        await this.syncWithAnki();
                    } catch (error) {
                        console.log("File not ready for processing, skipping auto-sync");
                    }
                }
            });
        }
    }

    async startNewOperation(operationType: string): Promise<void> {
        this.currentOperationId = `${operationType}-${Date.now()}`;
        await this.clearLogFile();
        this.resetCancel();

        this.failedWordsInCurrentOperation.clear();

        const operationNames: { [key: string]: string } = {
            "anki-sync": "Anki Sync",
            "translation": "Translation Processing",
            "numbering": "Row Numbering",
            "auto-sync": "Auto Sync"
        };

        const operationName = operationNames[operationType] || operationType;
        await this.logEvent(`Starting ${operationName} Operation`, "info");
        await this.logEvent(`Operation ID: ${this.currentOperationId}`, "info");
        await this.logEvent(`Timestamp: ${new Date().toLocaleString()}`, "info");
    }

    async processWordsFileAdvanced(): Promise<void> {
        this.isProcessing = true;
        let operationSummary: OperationSummary | null = null;

        try {
            await this.validateCurrentModel();

            const sourceLang = this.settings.sourceLanguage;
            const targetLang = this.settings.targetLanguage;

            if (this.settings.dryRun) {
                await this.logEvent(`[DRY RUN MODE] Preview only - no API calls or file changes`, "info");
            }

            await this.logEvent(`Starting PROFESSIONAL processing (${sourceLang} → ${targetLang})`, "info");
            await this.logEvent(`Quality mode: ${this.settings.translationQuality}`, "info");
            await this.logEvent('Using: Cloudflare Worker', "info");
            await this.logEvent(`Model: ${this.settings.groqModel}`, "info");
            await this.logEvent(`Batch size: ${this.settings.batchSize}`, "info");

            const normalizedPath = normalizePath(this.settings.filePath);
            const file = this.app.vault.getAbstractFileByPath(normalizedPath);

            if (!(file instanceof TFile)) {
                await this.logEvent("Vocabulary file not found", "error");
                new Notice("Vocabulary file not found");
                return;
            }

            await this.app.vault.read(file);

            await this.logEvent(`Processing file: ${this.settings.filePath}`, "info");

            const content = await this.app.vault.read(file);
            const lines = content.split("\n");
            const wordsToProcess = await this.extractWordsNeedingProcessing(lines, sourceLang, targetLang);
            this.operationSummaryManager.startOperation(this.currentOperationId, wordsToProcess.length);

            await this.updateTableAdvanced(file, sourceLang, targetLang);

            operationSummary = this.operationSummaryManager.completeOperation('completed');
            const summaryReport = this.operationSummaryManager.generateSummaryReport(operationSummary);
            await this.logEvent(summaryReport, "success");

            const modeLabel = this.settings.dryRun ? " (DRY RUN - Preview Only)" : "";
            await this.logEvent(`Professional processing completed successfully${modeLabel}`, "success");
            new Notice(`Professional processing completed${modeLabel} - ${sourceLang} → ${targetLang}`);
        } catch (error: any) {
            operationSummary = this.operationSummaryManager.completeOperation('failed', error.message);
            const summaryReport = this.operationSummaryManager.generateSummaryReport(operationSummary);
            await this.logEvent(summaryReport, "error");
            await this.logEvent(`Professional processing error: ${error.message}`, "error");

            if (error.message.includes('Model Not Available') || error.message.includes('model_not_available')) {
                new Notice(`❌ Translation failed: Model not available. Please check settings and select a valid model.`, 10000);
            } else if (error.message.includes('No table found')) {
                new Notice(`❌ No table found in the file. Please check the file format.`, 10000);
            } else {
                new Notice(`Processing error: ${error.message}`);
            }
            try { this.clearProgress(); } catch { }
        } finally {
            this.isProcessing = false;
            this.clearProgress();
        }
    }

    private async validateCurrentModel(): Promise<void> {
        const availableModels = this.settings.availableModels || {};
        const currentModel = this.settings.groqModel;
        if (!availableModels[currentModel]) {
            await this.logEvent(`⚠️ Current model "${currentModel}" is not available in local list`, 'warning');
        }
    }

    private async autoFixModelNames(): Promise<void> {
        const modelMigrations: Record<string, string> = {
            "openai/gpt-oss-120": "openai/gpt-oss-20",
            "llama-3.1-70b-versatile": "llama-3.3-70b-versatile",
            "qwen/qwen2.5-32b": "qwen/qwen3-32b",
        };

        let wasUpdated = false;

        if (this.settings.enableConsensus && Array.isArray(this.settings.consensusModels)) {
            const updatedConsensusModels = this.settings.consensusModels.map(model =>
                modelMigrations[model] || model
            ).filter(model => this.settings.availableModels?.[model]);

            if (JSON.stringify(updatedConsensusModels) !== JSON.stringify(this.settings.consensusModels)) {
                this.settings.consensusModels = updatedConsensusModels;
                wasUpdated = true;
                await this.logEvent("Automatically updated consensus models list", "info");
            }
        }

        if (wasUpdated) {
            await this.saveSettings();
            new Notice(`🔄 Model settings have been automatically updated`, 5000);
            await this.logEvent("Model settings auto-update completed successfully", "success");
        }
    }

    async updateTableAdvanced(file: TFile, sourceLang: string, targetLang: string): Promise<void> {
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");

        let tableStartIndex = -1;
        let tableEndIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && !this.isSeparatorRow(line) && !this.isHeaderRow(line)) {
                if (tableStartIndex === -1) {
                    tableStartIndex = i;
                }
                tableEndIndex = i;
            }
        }

        if (tableStartIndex === -1) {
            throw new Error("No table found in file");
        }

        const tableLines = lines.slice(tableStartIndex, tableEndIndex + 1);

        const wordsToProcess = await this.extractWordsNeedingProcessing(tableLines, sourceLang, targetLang);

        if (wordsToProcess.length === 0) {
            await this.logEvent("No words need processing - all data is complete", "success");
            return;
        }

        await this.logEvent(`Found ${wordsToProcess.length} words needing processing`, "info");

        if (this.settings.dryRun) {
            await this.logEvent(`[DRY RUN] Words that would be translated:`, "info");
            const preview = wordsToProcess.slice(0, 10).join(", ");
            const more = wordsToProcess.length > 10 ? ` ... and ${wordsToProcess.length - 10} more` : "";
            await this.logEvent(`  ${preview}${more}`, "info");
            const batches = Math.ceil(wordsToProcess.length / this.settings.batchSize);
            await this.logEvent(`[DRY RUN] Would send ${batches} batches to translation service`, "info");
            await this.logEvent(`[DRY RUN] Would update ${wordsToProcess.length} rows in file`, "info");
            await this.logEvent(`[DRY RUN] No API calls made, no file changes applied`, "success");
            return;
        }

        await this.logEvent(`Words to process: ${wordsToProcess.join(", ")}`, "info");

        const translationResults = await this.batchManager.processWordsInBatches(
            wordsToProcess, sourceLang, targetLang
        );

        await this.logEvent(`Successfully processed ${translationResults.size} words`, "success");

        await this.updateTableWithResults(file, lines, translationResults);
    }

    private async extractWordsNeedingProcessing(rows: string[], sourceLang: string, targetLang: string): Promise<string[]> {
        const words: string[] = [];
        let isFirstDataRow = true;

        for (const row of rows) {
            if (!row.trim() || !row.includes("|")) continue;

            if (this.isSeparatorRow(row)) continue;

            const cells = this.splitTableRow(row);
            if (cells.length < 2) continue;

            if (isFirstDataRow) {
                isFirstDataRow = false;
                if (this.isHeaderRow(row)) {
                    if (this.settings.logLevel === 'detailed') {
                        await this.logEvent("Skipping table header row", "info");
                    }
                    continue;
                }
            }

            const sourceWord = cells[1]?.trim();

            if (!sourceWord ||
                this.isSeparatorRow(row) ||
                this.isHeaderRow(row) ||
                sourceWord === '' ||
                sourceWord.includes('#') ||
                /^\d+$/.test(sourceWord)) {
                continue;
            }

            if (this.failedWordsInCurrentOperation.has(sourceWord.toLowerCase())) {
                if (this.settings.logLevel === 'detailed') {
                    await this.logEvent(`Skipping word that failed in current operation: "${sourceWord}"`, "info");
                }
                continue;
            }

            const translation = cells[2]?.trim() || "";
            const definition = cells[3]?.trim() || "";
            const exampleSource = cells[4]?.trim() || "";
            const exampleTarget = cells[5]?.trim() || "";

            const isAlreadyComplete = translation && translation.trim() !== '' && translation.trim() !== '---' &&
                definition && definition.trim() !== '' && definition.trim() !== '---' &&
                exampleSource && exampleSource.trim() !== '' && exampleSource.trim() !== '---' &&
                exampleTarget && exampleTarget.trim() !== '' && exampleTarget.trim() !== '---';

            if (isAlreadyComplete) {
                continue;
            }

            if (this.needsProcessing(sourceWord, translation, definition, exampleSource, exampleTarget, sourceLang, targetLang)) {
                words.push(sourceWord);
            }
        }

        if (this.settings.logLevel === 'detailed') {
            await this.logEvent(`Total words needing processing: ${words.length}`, "info");
        }
        return words;
    }

    private isHeaderRow(row: string): boolean {
        const cells = this.splitTableRow(row);

        if (cells.length === 0) return false;

        const firstCell = cells[0]?.toLowerCase().trim();
        const secondCell = cells[1]?.toLowerCase().trim();

        const headerIndicators = [
            '#', 'number', 'num', 'no.',
            'word', 'source', 'original',
            'translation', 'trans', 'meaning',
            'definition', 'def', 'explanation',
            'example', 'ex', 'sentence',
            'translated example', 'translation ex'
        ];

        const isHeader = headerIndicators.some(indicator =>
            firstCell?.includes(indicator) ||
            secondCell?.includes(indicator)
        );

        return isHeader || this.isSeparatorRow(row);
    }

    private isSeparatorRow(row: string): boolean {
        const trimmed = row.trim();
        if (!trimmed.startsWith('|')) return false;

        const cells = this.splitTableRow(row);
        return cells.some(cell => /^:?-{3,}:?$/.test(cell.trim()));
    }

    private needsProcessing(sourceWord: string, translation: string, definition: string, exampleSource: string, exampleTarget: string, sourceLang: string, targetLang: string): boolean {
        if (!sourceWord || sourceWord.trim() === '' || sourceWord.includes('---') || sourceWord.includes('#')) {
            return false;
        }

        const isAlreadyComplete = translation && translation.trim() !== '' && translation.trim() !== '---' &&
            definition && definition.trim() !== '' && definition.trim() !== '---' &&
            exampleSource && exampleSource.trim() !== '' && exampleSource.trim() !== '---' &&
            exampleTarget && exampleTarget.trim() !== '' && exampleTarget.trim() !== '---';

        if (isAlreadyComplete) {
            return false;
        }

        const hasEmptyField = (
            (!translation || translation.trim() === '' || translation.trim() === '---') ||
            (!definition || definition.trim() === '' || definition.trim() === '---') ||
            (!exampleSource || exampleSource.trim() === '' || exampleSource.trim() === '---') ||
            (!exampleTarget || exampleTarget.trim() === '' || exampleTarget.trim() === '---')
        );

        return hasEmptyField;
    }

    private async updateTableWithResults(file: TFile, originalRows: string[], results: Map<string, GroqTranslationResult>): Promise<void> {
        const newRows: string[] = [];
        let updatedCount = 0;
        let skippedCompleteCount = 0;

        for (let i = 0; i < originalRows.length; i++) {
            const row = originalRows[i];

            if (!row.trim()) {
                newRows.push(row);
                continue;
            }

            if (!row.includes("|")) {
                newRows.push(row);
                continue;
            }

            const parts = this.splitTableRow(row);

            if (parts.length < 2) {
                newRows.push(row);
                continue;
            }

            const num = parts[0];
            const sourceWord = parts[1]?.trim();

            if (!sourceWord || this.isSeparatorRow(row) || this.isHeaderRow(row)) {
                newRows.push(row);
                continue;
            }

            const translation = parts[2] || "";
            const definition = parts[3] || "";
            const exampleSource = parts[4] || "";
            const exampleTarget = parts[5] || "";
            const isAlreadyComplete = translation && translation.trim() !== '' && translation.trim() !== '---' &&
                definition && definition.trim() !== '' && definition.trim() !== '---' &&
                exampleSource && exampleSource.trim() !== '' && exampleSource.trim() !== '---' &&
                exampleTarget && exampleTarget.trim() !== '' && exampleTarget.trim() !== '---';

            let foundResult: GroqTranslationResult | undefined;

            if (results.has(sourceWord)) {
                foundResult = results.get(sourceWord);
            } else {
                for (const [key, value] of results.entries()) {
                    if (key.toLowerCase() === sourceWord.toLowerCase()) {
                        foundResult = value;
                        break;
                    }
                }
            }

            if (foundResult) {
                if (isAlreadyComplete) {
                    const originalRow = `| ${this.escapeTableCell(num)} | ${this.escapeTableCell(sourceWord)} | ${this.escapeTableCell(translation)} | ${this.escapeTableCell(definition)} | ${this.escapeTableCell(exampleSource)} | ${this.escapeTableCell(exampleTarget)} |`;
                    newRows.push(originalRow);
                    skippedCompleteCount++;
                    continue;
                }

                const newTranslation = (!translation || translation.trim() === '' || translation.trim() === '---') && foundResult.translation && foundResult.translation.trim()
                    ? foundResult.translation : translation;
                const newDefinition = (!definition || definition.trim() === '' || definition.trim() === '---') && foundResult.definition && foundResult.definition.trim()
                    ? foundResult.definition : definition;
                const newExampleSource = (!exampleSource || exampleSource.trim() === '' || exampleSource.trim() === '---') && foundResult.exampleSource && foundResult.exampleSource.trim()
                    ? foundResult.exampleSource : exampleSource;
                const newExampleTarget = (!exampleTarget || exampleTarget.trim() === '' || exampleTarget.trim() === '---') && foundResult.exampleTarget && foundResult.exampleTarget.trim()
                    ? foundResult.exampleTarget : exampleTarget;

                const newRow = `| ${this.escapeTableCell(num)} | ${this.escapeTableCell(sourceWord)} | ${this.escapeTableCell(newTranslation)} | ${this.escapeTableCell(newDefinition)} | ${this.escapeTableCell(newExampleSource)} | ${this.escapeTableCell(newExampleTarget)} |`;
                newRows.push(newRow);

                const updatedFields = [];
                if (newTranslation !== translation) updatedFields.push('translation');
                if (newDefinition !== definition) updatedFields.push('definition');
                if (newExampleSource !== exampleSource) updatedFields.push('example');
                if (newExampleTarget !== exampleTarget) updatedFields.push('translated example');

                if (updatedFields.length > 0) {
                    updatedCount++;
                }
            } else {
                const originalRow = `| ${this.escapeTableCell(num)} | ${this.escapeTableCell(sourceWord)} | ${this.escapeTableCell(translation)} | ${this.escapeTableCell(definition)} | ${this.escapeTableCell(exampleSource)} | ${this.escapeTableCell(exampleTarget)} |`;
                newRows.push(originalRow);

                if (sourceWord && sourceWord.trim() && !sourceWord.includes('---') && !isAlreadyComplete) {
                }
            }
        }

        const newContent = newRows.join("\n");
        await this.app.vault.modify(file, newContent);

        if (updatedCount > 0) {
            await this.logEvent(`✅ Updated ${updatedCount} words in table`, "success");
        }
        if (skippedCompleteCount > 0 && this.settings.logLevel === 'detailed') {
            await this.logEvent(`📋 ${skippedCompleteCount} words were already complete`, "info");
        }
    }

    private splitTableRow(row: string): string[] {
        const trimmed = row.trim();
        if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
            return [];
        }

        const content = trimmed.slice(1, -1).trim();

        const cells: string[] = [];
        let current = '';
        let inEscape = false;

        for (let i = 0; i < content.length; i++) {
            const ch = content[i];

            if (inEscape) {
                current += ch;
                inEscape = false;
                continue;
            }

            if (ch === '\\') {
                inEscape = true;
                continue;
            }

            if (ch === '|') {
                cells.push(current.trim());
                current = '';
                continue;
            }

            current += ch;
        }

        if (current.length > 0) {
            cells.push(current.trim());
        }

        return cells;
    }

    private escapeTableCell(text: string): string {
        if (!text) return '';
        let escaped = text.replace(/\|/g, '\\|');
        escaped = escaped.replace(/\n/g, ' ');
        return escaped.trim();
    }

    getLanguageConfig(langCode: string): LanguageConfig {
        const config = this.settings.remoteConfig;
        if (config) {
            const lang = config.supported_languages.find(lang => lang.code === langCode);
            if (lang) return lang;
        }

        return {
            code: langCode,
            name: langCode.toUpperCase(),
            nativeName: langCode.toUpperCase(),
            rtl: false,
            flag: "🏳️"
        };
    }

    getLanguageName(langCode: string): string {
        return this.getLanguageConfig(langCode).name;
    }

    isRTLLanguage(langCode: string): boolean {
        return this.getLanguageConfig(langCode).rtl;
    }

    getColumnStyle(columnIndex: number): ColumnStyle {
        const styles = [
            this.settings.column1Style,
            this.settings.column2Style,
            this.settings.column3Style,
            this.settings.column4Style,
            this.settings.column5Style,
            this.settings.column6Style
        ];
        return styles[columnIndex - 1] || styles[0];
    }

    formatColumnContent(content: string, columnIndex: number, languageCode: string): string {
        if (!content.trim()) return "";

        const style = this.getColumnStyle(columnIndex);
        const isRTL = this.isRTLLanguage(languageCode);
        const direction = isRTL ? 'rtl' : 'ltr';
        const alignment = isRTL ? 'right' : 'left';

        return `<div style="color:${style.color}; font-size:${style.fontSize}; font-weight:${style.fontWeight}; direction:${direction}; text-align:${alignment}; padding:5px;">${content}</div>`;
    }

    async numberTableRows(): Promise<void> {
        this.isProcessing = true;
        try {
            const normalizedPath = normalizePath(this.settings.filePath);
            const file = this.app.vault.getAbstractFileByPath(normalizedPath);

            if (!(file instanceof TFile)) {
                await this.logEvent("File not found", "error");
                new Notice("File not found");
                return;
            }

            await this.logEvent("Starting row numbering operation", "info");
            await this.renumberTable(file);

            await this.logEvent("Rows numbered successfully", "success");
            new Notice("Rows numbered successfully");
        } catch (error: any) {
            await this.logEvent(`Row numbering error: ${error.message}`, "error");
            new Notice("Row numbering error");
        } finally {
            this.isProcessing = false;
        }
    }

    async renumberTable(file: TFile): Promise<void> {
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");

        if (lines.length === 0) return;

        const newLines: string[] = [];
        let i = 0;
        let totalRenumbered = 0;

        const isTableLine = (line: string) => line.trim().startsWith('|');
        const isSeparatorLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('|')) return false;
            const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
            if (cells.length === 0) return false;
            return cells.every(c => c.length > 0 && /^:?-{3,}:?$/.test(c));
        };

        while (i < lines.length) {
            const line = lines[i];
            const next = i + 1 < lines.length ? lines[i + 1] : '';

            if (isTableLine(line) && isTableLine(next) && isSeparatorLine(next)) {
                newLines.push(line);
                newLines.push(next);
                i += 2;

                let rowNumber = 1;
                while (i < lines.length && isTableLine(lines[i])) {
                    const row = lines[i];
                    if (isSeparatorLine(row)) {
                        newLines.push(row);
                        i++;
                        continue;
                    }

                    const cells = row.trim().split('|').map(c => c.trim()).slice(1, -1);
                    if (cells.length >= 6) {
                        cells[0] = `${rowNumber}`;
                        const newRow = `| ${cells.join(' | ')} |`;
                        newLines.push(newRow);
                        rowNumber++;
                        totalRenumbered++;
                    } else {
                        newLines.push(row);
                    }
                    i++;
                }
                continue;
            }

            newLines.push(line);
            i++;
        }

        const newContent = newLines.join("\n");
        await this.app.vault.modify(file, newContent);
        await this.logEvent(`Renumbered ${totalRenumbered} rows`, "success");
    }

    getLogFilePath(): string {
        if (this.settings.logFolder && this.settings.logFolder.trim() !== "") {
            const normalizedFolder = normalizePath(this.settings.logFolder.trim());
            return `${normalizedFolder}/Anki Sync Log.md`;
        }
        return "Anki Sync Log.md";
    }

    async ensureLogFile(): Promise<TFile | null> {
        if (this.logFileEnsuring) return this.logFileEnsuring;
        this.logFileEnsuring = (async () => {
            const logFilePath = this.getLogFilePath();
            try {
                if (this.settings.logFolder && this.settings.logFolder.trim() !== "") {
                    const folderPath = normalizePath(this.settings.logFolder.trim());
                    const folderExists = await this.app.vault.adapter.exists(folderPath);
                    if (!folderExists) {
                        await this.app.vault.createFolder(folderPath);
                    }
                }

                const fileExists = await this.app.vault.adapter.exists(logFilePath);
                if (!fileExists) {
                    try {
                        await this.app.vault.create(logFilePath, "# Anki Sync Log\n\n");
                    } catch (e: any) {
                    }
                }

                const created = this.app.vault.getAbstractFileByPath(logFilePath);
                return created instanceof TFile ? created : null;
            } catch (error: any) {
                const created = this.app.vault.getAbstractFileByPath(logFilePath);
                return created instanceof TFile ? created : null;
            } finally {
                setTimeout(() => { this.logFileEnsuring = null; }, 0);
            }
        })();
        return this.logFileEnsuring;
    }

    async clearLogFile(): Promise<void> {
        try {
            const file = await this.ensureLogFile();
            if (!file) return;
            const timestamp = new Date().toLocaleString();
            const header = `# Anki Sync Log\n\n> Operation started: ${timestamp}\n\n---\n\n`;
            await this.app.vault.modify(file, header);
        } catch (error) {
            console.error("Error clearing log file:", error);
        }
    }

    async logEvent(message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info'): Promise<void> {
        if (this.settings.logLevel === 'minimal' && level === 'info') return;
        if (this.settings.logLevel === 'standard' && level === 'info' && (
            message.includes('needs processing') ||
            message.includes('TABLE STRUCTURE') ||
            message.includes('DEBUG')
        )) return;

        try {
            const file = await this.ensureLogFile();
            if (!file) return;
            const timestamp = new Date().toLocaleTimeString();
            const levelIcon = this.getLevelIcon(level);
            const content = await this.app.vault.read(file);
            const newContent = content + `- **${timestamp}** ${levelIcon} ${message}\n`;
            await this.app.vault.modify(file, newContent);
        } catch (error) {
            console.debug("LogEvent (non-fatal):", error);
        }
    }

    getLevelIcon(level: string): string {
        switch (level) {
            case 'success': return '✅';
            case 'warning': return '⚠️';
            case 'error': return '❌';
            default: return 'ℹ️';
        }
    }

    async syncWithAnki(): Promise<void> {
        this.isProcessing = true;
        try {
            if (this.settings.dryRun) {
                await this.logEvent(`[DRY RUN MODE] Preview only - no cards added/updated`, "info");
            }

            await this.logEvent("Starting Anki sync operation", "info");
            await this.logEvent(`Deck: ${this.settings.deckName}`, "info");
            await this.logEvent(`Note type: ${this.settings.noteType}`, "info");

            if (!await this.checkAnkiConnect()) {
                await this.logEvent("Anki Connect not available", "error");
                new Notice("Anki Connect not available");
                return;
            }

            await this.logEvent("Anki Connect is available", "success");

            const normalizedPath = normalizePath(this.settings.filePath);
            const file = this.app.vault.getAbstractFileByPath(normalizedPath);

            if (!(file instanceof TFile)) {
                await this.logEvent("Vocabulary file not found", "error");
                new Notice("File not found");
                return;
            }

            await this.logEvent("Auto-numbering table rows before Anki sync", "info");
            await this.renumberTable(file);

            const content = await this.app.vault.read(file);
            const lines = content.split("\n");
            let noteMap = await this.loadNotesMap();
            let processedCount = 0;
            let addedCount = 0;
            let updatedCount = 0;
            let skippedCount = 0;
            let otherDeckCount = 0;

            await this.logEvent(`Processing ${lines.length} lines from vocabulary file`, "info");

            let invalidFrontCount = 0;
            const invalidFrontSamples: string[] = [];
            let wouldAddCount = 0;
            let wouldUpdateCount = 0;
            let wouldSkipCount = 0;

            for (const line of lines) {
                if (!this.isDataRow(line)) continue;

                const cells = this.parseTableRow(line);
                if (cells && cells.length >= this.settings.frontColumn) {
                    const frontValue = cells[this.settings.frontColumn - 1];

                    const validFront = this.isValidFront(frontValue);
                    if (!validFront && this.settings.showFrontWarning) {
                        invalidFrontCount++;
                        if (invalidFrontSamples.length < 5) invalidFrontSamples.push(frontValue || '(empty)');
                        await this.logEvent(`Skipped invalid front value: "${frontValue}"`, 'warning');
                        continue;
                    }

                    if (frontValue && validFront) {
                        if (this.settings.dryRun) {
                            const normFront = frontValue.toLowerCase().trim();
                            const existing = noteMap.get(normFront);
                            if (existing) {
                                wouldUpdateCount++;
                            } else {
                                wouldAddCount++;
                            }
                            processedCount++;
                            continue;
                        }
                        const result = await this.updateOrAddNote(
                            noteMap,
                            frontValue.trim(),
                            cells[2] || "",
                            cells[3] || "",
                            cells[4] || "",
                            cells[5] || ""
                        );

                        switch (result) {
                            case 'added':
                                addedCount++;
                                await this.logEvent(`Added new card: "${frontValue}"`, "success");
                                break;
                            case 'updated':
                                updatedCount++;
                                await this.logEvent(`Updated existing card: "${frontValue}"`, "success");
                                break;
                            case 'skipped':
                                skippedCount++;
                                if (this.settings.logLevel === 'detailed') {
                                    await this.logEvent(`No changes needed: "${frontValue}"`, "info");
                                }
                                break;
                            case 'other_deck':
                                otherDeckCount++;
                                await this.logEvent(`Card exists in different deck: "${frontValue}"`, "warning");
                                break;
                        }

                        processedCount++;
                    }
                }
            }

            let summaryMessage: string;
            if (this.settings.dryRun) {
                summaryMessage = `[DRY RUN] Would process ${processedCount} cards: ${wouldAddCount} new, ${wouldUpdateCount} updates`;
                await this.logEvent(summaryMessage, "success");
                await this.logEvent(`[DRY RUN] No cards were actually added or updated`, "info");
            } else {
                summaryMessage = `Sync completed: ${processedCount} processed, ${addedCount} added, ${updatedCount} updated, ${skippedCount} unchanged, ${otherDeckCount} in other decks`;
                await this.logEvent(summaryMessage, "success");
            }
            new Notice(summaryMessage);

            if (this.settings.showFrontWarning && invalidFrontCount > 0) {
                const warn = `⚠️ Skipped ${invalidFrontCount} rows with invalid fronts. Examples: ${invalidFrontSamples.join(', ')}`;
                await this.logEvent(warn, 'warning');
                new Notice(warn);
            }

        } catch (error) {
            const errorMessage = "Sync error occurred";
            await this.logEvent(errorMessage, "error");
            new Notice(errorMessage);
        } finally {
            this.isProcessing = false;
            this.clearProgress();
        }
    }

    isDataRow(line: string): boolean {
        const trimmedLine = line.trim();
        return trimmedLine.startsWith('|') && !trimmedLine.includes('---') && trimmedLine.length > 10;
    }

    parseTableRow(line: string): string[] | null {
        try {
            const trimmedLine = line.trim();
            if (trimmedLine.includes('---')) return null;

            const cells = trimmedLine.split('|').map(cell => cell.trim());
            return cells.slice(1, -1);
        } catch (error) {
            return null;
        }
    }

    isValidFront(front: string): boolean {
        if (!front) return false;
        const f = front.trim();
        if (!f) return false;
        if (f.includes('---')) return false;
        if (/^\d+$/.test(f)) return false;
        return true;
    }

    async checkAnkiConnect(): Promise<boolean> {
        try {
            const res = await fetch(`http://127.0.0.1:${this.settings.ankiConnectPort}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "version", version: 6 }),
                signal: this.getTimeoutSignal(5000)
            });
            return res.ok;
        } catch (error) {
            return false;
        }
    }

    async loadNotesMap(): Promise<Map<string, any>> {
        try {
            const res = await fetch(`http://127.0.0.1:${this.settings.ankiConnectPort}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "findNotes",
                    version: 6,
                    params: { query: `deck:"${this.settings.deckName}"` }
                })
            });

            if (!res.ok) return new Map();
            const noteIds = (await res.json()).result;

            if (noteIds.length === 0) return new Map();

            const notesRes = await fetch(`http://127.0.0.1:${this.settings.ankiConnectPort}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "notesInfo",
                    version: 6,
                    params: { notes: noteIds }
                })
            });

            const notes = (await notesRes.json()).result;
            const noteMap = new Map();

            for (let note of notes) {
                if (note.fields?.Front) {
                    noteMap.set(note.fields.Front.value.toLowerCase(), note);
                }
            }

            await this.logEvent(`Loaded ${noteMap.size} existing notes from deck`, "info");
            return noteMap;
        } catch (error) {
            await this.logEvent("Could not load existing notes - starting with empty map", "warning");
            return new Map();
        }
    }

    async updateOrAddNote(noteMap: Map<string, any>, front: string, translation: string, definition: string, exampleSource: string, exampleTarget: string): Promise<'added' | 'updated' | 'skipped' | 'other_deck'> {
        try {
            const normFront = front.toLowerCase();
            let newBack = "";
            const targetLang = this.settings.targetLanguage;
            const sourceLang = this.settings.sourceLanguage;

            if (translation) newBack += this.formatColumnContent(translation, 3, targetLang);
            if (definition) newBack += "<br/>" + this.formatColumnContent(definition, 4, targetLang);
            if (exampleSource) newBack += "<br/>" + this.formatColumnContent(exampleSource, 5, sourceLang);
            if (exampleTarget) newBack += "<br/>" + this.formatColumnContent(exampleTarget, 6, targetLang);

            const existing = noteMap.get(normFront);
            let tags = this.settings.enableCustomTags ?
                this.settings.ankiTags.split(',').map(t => t.trim()) :
                ["obsidian", `lang-${sourceLang}`, `lang-${targetLang}`];

            const allNotesResult = await fetch(`http://127.0.0.1:${this.settings.ankiConnectPort}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "findNotes",
                    version: 6,
                    params: { query: `"Front:${front.replace(/"/g, '\\"')}"` }
                })
            });

            const allNoteIds = (await allNotesResult.json()).result;

            if (allNoteIds.length > 0 && !existing) {
                return 'other_deck';
            }

            if (existing) {
                const currentBack = existing.fields?.Back?.value || "";
                if (currentBack === newBack) {
                    return 'skipped';
                }

                await fetch(`http://127.0.0.1:${this.settings.ankiConnectPort}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "updateNoteFields",
                        version: 6,
                        params: {
                            note: {
                                id: existing.noteId,
                                fields: { Front: front, Back: newBack },
                                tags: tags
                            }
                        }
                    })
                });
                return 'updated';
            } else {
                await fetch(`http://127.0.0.1:${this.settings.ankiConnectPort}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "addNote",
                        version: 6,
                        params: {
                            note: {
                                deckName: this.settings.deckName,
                                modelName: this.settings.noteType,
                                fields: { Front: front, Back: newBack },
                                tags: tags
                            }
                        }
                    })
                });
                return 'added';
            }
        } catch (error) {
            console.error("Error updating note:", error);
            throw error;
        }
    }

    async testGroqConnection(): Promise<void> {
        const pathName = 'Cloudflare Worker';

        try {
            await this.logEvent(`Testing connection (${pathName})`, "info");
            const testWords = ["hello"];
            const results = await this.batchManager.processWordsInBatches(testWords, this.settings.sourceLanguage, this.settings.targetLanguage);
            const ok = results && results.size > 0;
            const statusIcon = ok ? '✅' : '⚠️';
            const detail = ok ? `Received ${results.size} item(s)` : `No results`;
            await this.logEvent(`${statusIcon} ${pathName} test: ${detail}`, ok ? 'success' : 'warning');
            new Notice(`${statusIcon} ${pathName} test: ${detail}`);
        } catch (error: any) {
            const errorMessage = `❌ ${pathName} connection failed: ${error.message}`;
            await this.logEvent(errorMessage, "error");
            new Notice(errorMessage);
        }
    }

    async showUpdateAndEndpoints(): Promise<void> {
        const config = this.settings.remoteConfig;
        if (!config) {
            new Notice("Remote configuration not loaded");
            return;
        }

        const active = this.settings.activeWorkerUrl || '(none)';
        const backup = (this.settings.backupWorkerUrls && this.settings.backupWorkerUrls[0]) || '(none)';
        const manifestVer = (this as any)?.manifest?.version as string | undefined;
        const serverVer = config.update_info?.version || 'unknown';
        const hasUpdate = manifestVer && serverVer && this.compareVersions(manifestVer, serverVer) < 0;

        new Notice(`Remote Config Status:` +
            `\nUpdate available: ${hasUpdate ? 'Yes' : 'No'}` +
            `\nCurrent: ${manifestVer || 'unknown'}` +
            `\nServer: ${serverVer}` +
            `\nPrimary endpoint: ${config.endpoints.primary}` +
            `\nBackup endpoints: ${config.endpoints.backups.length}` +
            `\nLanguages: ${config.supported_languages.length}` +
            `\nModels: ${Object.keys(config.models.options).length}`
            , 5000);
    }

    async testJSONFormat(): Promise<void> {
        if (!this.settings.useJSONFormat) {
            new Notice("JSON format is not enabled");
            return;
        }

        try {
            await this.logEvent("Testing JSON format response", "info");

            const testWords = ["hello", "world"];
            const results = await this.batchManager.processWordsInBatches(testWords, this.settings.sourceLanguage, this.settings.targetLanguage);
            if (results.size > 0) {
                const message = `JSON format test successful! Received ${results.size} translations correctly`;
                await this.logEvent(message, "success");
                results.forEach((res, word) => {
                    this.logEvent(`"${word}" → "${res.translation}"`, "success");
                });
                new Notice("JSON format test: SUCCESS");
            } else {
                throw new Error("No valid translations returned");
            }

        } catch (error: any) {
            const errorMessage = `JSON format test failed: ${error.message}`;
            await this.logEvent(errorMessage, "error");
            new Notice("JSON format test: FAILED");
        }
    }

    showModelSelectedNotification(modelName: string): void {
        const availableModels = this.settings.availableModels || {};
        const modelDisplayName = availableModels[modelName] || modelName;
        const isHighLimit = this.isHighLimitModel();
        const limitType = isHighLimit ? "High-limit (60 RPM)" : "Standard (30 RPM)";
        new Notice(`Selected model: ${modelDisplayName}\n${limitType}`);
    }

    updatePerformanceStats(): void {
        if (this.performanceUpdateTimer) {
            clearTimeout(this.performanceUpdateTimer);
        }

        this.performanceUpdateTimer = window.setTimeout(() => {
            const event = new CustomEvent('vocabulary-sync-performance-update');
            document.dispatchEvent(event);
        }, 500);
    }

    async clearCache(): Promise<void> {
        this.translationCache.clear();
        this.cacheStore = {};
        try { await this.saveCacheStore(); } catch { }
        await this.logEvent("AI memory cleared (cache + persisted store)", "success");
        new Notice("AI memory cleared");
    }

    async loadSettings(): Promise<void> {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});

        await this.autoFixModelNames();

        this.cacheStore = (data && (data as any).cacheStore) ? (data as any).cacheStore : {};
        const loadedStats = (data && (data as any).usageStats) ? (data as any).usageStats as UsageStats : undefined;
        if (loadedStats) {
            this.usageStats = Object.assign({ totalWordsProcessed: 0, successfulBatches: 0, failedBatches: 0, totalBatches: 0, totalBatchSize: 0 }, loadedStats);
        }
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        this.setupAutoSync();
    }

    getModelKeys(): string[] {
        const availableModels = this.settings.availableModels || {};
        return Object.keys(availableModels);
    }

    getModelIndexForKey(key: string, map?: Record<string, string>): number {
        const sourceMap = map && Object.keys(map).length > 0
            ? map
            : (this.settings.availableModels && Object.keys(this.settings.availableModels).length > 0
                ? (this.settings.availableModels as Record<string, string>)
                : {});
        const keys = Object.keys(sourceMap);
        const idx = keys.indexOf(key);
        return idx >= 0 ? idx : 0;
    }

    private getTimeoutSignal(ms: number): AbortSignal {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
    }
}

class VocabularyAnkiSyncSettingTab extends PluginSettingTab {
    plugin: VocabularyAnkiSyncPlugin;
    private performanceStatsEl: HTMLElement | null = null;
    private languageInfoEl: HTMLElement | null = null;
    private rpmSlider: HTMLInputElement | null = null;
    private rpmValueDisplay: HTMLElement | null = null;

    constructor(app: App, plugin: VocabularyAnkiSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('vocabulary-sync-settings');

        const headerEl = containerEl.createEl('div', { cls: 'vocabulary-sync-settings-header' });
        this.createHeader(headerEl);
        this.createSmartAutoModeToggle(containerEl);
        this.createSupportSection(containerEl);
        this.createFileSettings(containerEl);
        this.createLanguageSettings(containerEl);
        this.createGroqSettings(containerEl);
        this.createBatchSettings(containerEl);
        this.createAnkiSettings(containerEl);
        this.createStyleSettings(containerEl);
        this.createCommands(containerEl);
        this.createSolidarityMessage(containerEl);
        this.setupPerformanceUpdates();
    }

    setupPerformanceUpdates(): void {
        document.addEventListener('vocabulary-sync-performance-update', () => {
            this.updatePerformanceStats();
            this.updateRpmSliderLimit();
        });
    }

    createHeader(containerEl: HTMLElement): void {
        const header = containerEl.createEl('div', { attr: { style: 'text-align: center;' } });
        header.createEl('h1', { text: 'Vocab AnkiSync AI Translate' });
        header.createEl('p', {
            text: 'Advanced vocabulary processing and synchronization with Anki',
            attr: { style: 'color: var(--text-muted); margin-top: 10px;' }
        });
    }

    createSmartAutoModeToggle(containerEl: HTMLElement): void {
        const section = containerEl.createEl('div', { cls: 'vocabulary-sync-setting-section', attr: { style: 'border: 2px solid var(--interactive-accent); border-radius: 8px; padding: 16px; margin-bottom: 20px; background: var(--background-secondary);' } });

        const smartModeSetting = new Setting(section)
            .setName('🤖 Smart Auto Mode')
            .setDesc('Let the plugin intelligently optimize all settings for best quality. Manual controls will be hidden when enabled.')
            .addExtraButton(btn => btn
                .setIcon('info')
                .setTooltip('Enables adaptive batch sizing, quality scoring, and auto-retry. Recommended for most users.'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.smartAutoMode)
                .onChange(async (value) => {
                    this.plugin.settings.smartAutoMode = value;
                    this.plugin.settings.meaningsCount = value ? 2 : 1;
                    const lvl = this.plugin.settings.learnerLevel;
                    if (value) {
                        this.plugin.settings.enableConsensus = true;
                        this.plugin.settings.consensusMaxModels = 2;
                        if (!Array.isArray(this.plugin.settings.consensusModels) || this.plugin.settings.consensusModels.length < 2) {
                            this.plugin.settings.consensusModels = ['llama-3.3-70b-versatile', 'qwen/qwen3-32b'];
                        }
                        if (['A1', 'A2'].includes(lvl)) {
                            this.plugin.settings.simplifyExamplesForBeginners = true;
                            this.plugin.settings.limitDefinitionLength = true;
                            this.plugin.settings.addNuanceForAdvanced = false;
                        } else if (['C1', 'C2'].includes(lvl)) {
                            this.plugin.settings.addNuanceForAdvanced = true;
                            this.plugin.settings.simplifyExamplesForBeginners = false;
                            this.plugin.settings.limitDefinitionLength = false;
                        } else {
                            this.plugin.settings.simplifyExamplesForBeginners = false;
                            this.plugin.settings.limitDefinitionLength = false;
                            this.plugin.settings.addNuanceForAdvanced = false;
                        }
                    } else {
                        this.plugin.settings.enableConsensus = false;
                        if (['A1', 'A2'].includes(lvl)) {
                            this.plugin.settings.simplifyExamplesForBeginners = true;
                            this.plugin.settings.limitDefinitionLength = true;
                            this.plugin.settings.addNuanceForAdvanced = false;
                        } else if (['C1', 'C2'].includes(lvl)) {
                            this.plugin.settings.addNuanceForAdvanced = true;
                            this.plugin.settings.simplifyExamplesForBeginners = false;
                            this.plugin.settings.limitDefinitionLength = false;
                        } else { // B1/B2
                            this.plugin.settings.simplifyExamplesForBeginners = false;
                            this.plugin.settings.limitDefinitionLength = false;
                            this.plugin.settings.addNuanceForAdvanced = false;
                        }
                    }
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice(value ? '✓ Smart Auto Mode enabled - optimized settings active' : '⚙️ Manual Mode enabled - you have full control');
                }));
    }

    createSupportSection(containerEl: HTMLElement): void {
        const section = containerEl.createEl('div', { cls: 'vocabulary-sync-setting-section vocabulary-sync-support-section' });

        section.createEl('h2', { text: '💝 Support & Updates' });

        new Setting(section)
            .setName('Support development')
            .setDesc('If you find this plugin helpful, consider supporting future updates and features')
            .addButton(button => button
                .setButtonText('💖 Support via PayPal')
                .setCta()
                .onClick(() => {
                    window.open('https://paypal.me/YusufSuleiman004', '_blank');
                }));

        new Setting(section)
            .setName('Report an issue')
            .setDesc('Found a bug or have a feature request? Let us know on GitHub')
            .addButton(button => button
                .setButtonText('🐛 Report on GitHub')
                .onClick(() => {
                    window.open('https://github.com/YusufSuleiman/vocab-ankisync-ai-translate/issues', '_blank');
                }));

        new Setting(section)
            .setName('GitHub repository')
            .setDesc('View source code, contribute, or star the project')
            .addButton(button => button
                .setButtonText('⭐ Open GitHub')
                .onClick(() => {
                    const url = 'https://github.com/YusufSuleiman/vocab-ankisync-ai-translate';
                    try {
                        window.open(url, '_blank');
                    } catch {
                        try {
                            const { shell } = require('electron');
                            shell.openExternal(url);
                        } catch {
                            new Notice('Please open: ' + url);
                        }
                    }
                }));

        new Setting(section)
            .setName('Update notifications')
            .setDesc('Show a short notice once per session when a new plugin update is available (from the translation service).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableUpdateNotifications ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.enableUpdateNotifications = value;
                    await this.plugin.saveSettings();
                }));
    }

    createFileSettings(containerEl: HTMLElement): void {
        const section = containerEl.createEl('div', { cls: 'vocabulary-sync-setting-section' });

        section.createEl('h2', { text: '📁 File Settings' });

        new Setting(section)
            .setName("Vocabulary file path")
            .setDesc("Path to your vocabulary Markdown file")
            .addText(text => text
                .setPlaceholder("Vocabulary/Vocabulary.md")
                .setValue(this.plugin.settings.filePath)
                .onChange(async (value) => {
                    this.plugin.settings.filePath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName("Log folder path")
            .setDesc("Folder path for log file (leave empty for vault root)")
            .addText(text => text
                .setPlaceholder("Logs")
                .setValue(this.plugin.settings.logFolder)
                .onChange(async (value) => {
                    this.plugin.settings.logFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName("Log level")
            .setDesc("Detail level for operation logs")
            .addDropdown(dropdown => dropdown
                .addOption('detailed', 'Detailed')
                .addOption('minimal', 'Minimal')
                .setValue(this.plugin.settings.logLevel)
                .onChange(async (value) => {
                    this.plugin.settings.logLevel = value;
                    await this.plugin.saveSettings();
                }));
    }

    createLanguageSettings(containerEl: HTMLElement): void {
        const section = containerEl.createEl('div', { cls: 'vocabulary-sync-setting-section' });

        section.createEl('h2', { text: '🌍 Language Settings' });

        this.createLanguageDropdown(section, "sourceLanguage", "Source language", "Original language of the words");
        this.createLanguageDropdown(section, "targetLanguage", "Target language", "Language to translate to");

        this.languageInfoEl = section.createEl('div', { cls: 'vocabulary-sync-language-info' });
        this.updateLanguageInfo();
    }

    createLanguageDropdown(containerEl: HTMLElement, settingKey: string, name: string, desc: string): void {
        new Setting(containerEl)
            .setName(name)
            .setDesc(desc)
            .addDropdown(dropdown => {
                const config = this.plugin.settings.remoteConfig;
                const languages = config?.supported_languages || [];

                languages.forEach(lang => {
                    dropdown.addOption(lang.code, `${lang.flag} ${lang.name} - ${lang.nativeName}`);
                });

                const currentValue = this.plugin.settings[settingKey as keyof MyPluginSettings] as string;
                if (currentValue && !languages.some(lang => lang.code === currentValue)) {
                    dropdown.addOption(currentValue, `${currentValue.toUpperCase()} (Custom)`);
                }

                dropdown.setValue(currentValue)
                    .onChange(async (value) => {
                        (this.plugin.settings as any)[settingKey] = value;
                        await this.plugin.saveSettings();
                        this.updateLanguageInfo();
                    });
            });
    }

    updateLanguageInfo(): void {
        if (!this.languageInfoEl) return;

        const sourceLang = this.plugin.getLanguageConfig(this.plugin.settings.sourceLanguage);
        const targetLang = this.plugin.getLanguageConfig(this.plugin.settings.targetLanguage);

        this.languageInfoEl.empty();
        this.languageInfoEl.createEl('p', {
            text: `Current setup: ${sourceLang.flag} ${sourceLang.name} → ${targetLang.flag} ${targetLang.name}`,
            attr: { style: 'margin: 0; font-weight: bold; color: var(--text-accent);' }
        });
        this.languageInfoEl.createEl('p', {
            text: `Columns: 1. Number | 2. ${sourceLang.name} | 3. ${targetLang.name} | 4. Definition | 5. Example | 6. Example Translation`,
            attr: { style: 'margin: 5px 0 0 0; font-size: 0.9em;' }
        });
    }

    createGroqSettings(containerEl: HTMLElement): void {
        const section = containerEl.createEl('div', { cls: 'vocabulary-sync-setting-section' });

        section.createEl('h2', { text: '🔑 Professional Translation Service' });

        const tqSetting = new Setting(section)
            .setName("Translation quality")
            .setDesc("Select the depth and quality of translations and definitions. Higher quality may need smaller batches and can be slower.")
            .addExtraButton(btn => btn
                .setIcon('info')
                .setTooltip('Higher quality aims for richer definitions and better examples. Consider smaller batches for best results.'))
            .addDropdown(dropdown => dropdown
                .addOption('standard', 'Standard - Good balance of speed and quality')
                .addOption('professional', 'Professional - Detailed definitions and accurate translations')
                .addOption('comprehensive', 'Comprehensive - Maximum detail with extensive explanations')
                .setValue(this.plugin.settings.translationQuality)
                .onChange(async (value) => {
                    this.plugin.settings.translationQuality = value as 'standard' | 'professional' | 'comprehensive';
                    await this.plugin.saveSettings();
                    const bs = this.plugin.settings.batchSize;
                    const rec = value === 'comprehensive' ? 4 : (value === 'professional' ? 6 : null);
                    if (rec && bs > rec) {
                        new Notice(`Warning: Current batch size (${bs}) is above the recommended ${rec} for ${value} quality. Larger batches may reduce quality.`);
                    }
                }));

        new Setting(section)
            .setName("Test Cloudflare Worker")
            .setDesc("Verify your Cloudflare Worker is working correctly")
            .addButton(button => button
                .setButtonText("Test Worker")
                .onClick(async () => {
                    button.setButtonText("Testing...");
                    button.setDisabled(true);
                    try {
                        await this.plugin.testGroqConnection();
                    } catch (error) {
                    } finally {
                        button.setButtonText("Test Worker");
                        button.setDisabled(false);
                    }
                }));

        new Setting(section)
            .setName('Update Models & Languages')
            .setDesc('Force reload the latest models and languages from GitHub Config file')
            .addButton(button => button
                .setButtonText('🔄 Reload Config')
                .onClick(async () => {
                    button.setButtonText('Reloading...');
                    button.setDisabled(true);
                    await this.plugin.loadRemoteConfig();
                    button.setButtonText('🔄 Reload Config');
                    button.setDisabled(false);
                    this.display();
                }));

        const aiSetting = new Setting(section)
            .setName("AI Model")
            .setDesc("Model impacts translation quality and request limits (RPM caps).")
            .addExtraButton(btn => btn
                .setIcon('info')
                .setTooltip('Some models support higher RPM caps. Choose a model that balances quality and speed for your needs.'))
            .addDropdown(dropdown => {
                const availableModels = this.plugin.settings.availableModels || {};

                Object.entries(availableModels).forEach(([value, name]) => {
                    dropdown.addOption(value, name);
                });

                const current = this.plugin.settings.groqModel;
                if (current && !availableModels[current]) {
                    dropdown.addOption(current, `${current} (legacy)`);
                }

                const keys = Object.keys(availableModels);
                const currentIndex = Math.min(Math.max(0, this.plugin.settings.activeModelIndex ?? keys.indexOf(current)), Math.max(0, keys.length - 1));
                const effectiveModel = keys[currentIndex] || current || keys[0] || '';
                dropdown.setValue(effectiveModel)
                    .onChange(async (value) => {
                        const idx = keys.indexOf(value);
                        this.plugin.settings.activeModelIndex = idx >= 0 ? idx : 0;
                        this.plugin.settings.groqModel = value;
                        await this.plugin.saveSettings();
                        this.plugin.showModelSelectedNotification(value);
                    });
            });

        if (!this.plugin.settings.smartAutoMode) {
            new Setting(section)
                .setName('Translations per word')
                .setDesc('How many translation alternatives to include in the Translation field (separated by -).')
                .addExtraButton(btn => btn.setIcon('info').setTooltip('Controls how many alternatives appear in column 3 (Translation). They will be separated by " - ". The AI will provide the most common/accurate first, then synonyms.'))
                .addSlider(slider => slider
                    .setLimits(1, 3, 1)
                    .setValue(Math.max(1, Math.min(3, this.plugin.settings.meaningsCount || 1)))
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.meaningsCount = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(section)
                .setName('Meanings per definition')
                .setDesc('How many meanings to include inside the definition (separated by |)')
                .addExtraButton(btn => btn
                    .setIcon('info')
                    .setTooltip('Controls how many meanings appear within the definition field.'))
                .addSlider(slider => slider
                    .setLimits(1, 3, 1)
                    .setValue(Math.max(1, Math.min(3, this.plugin.settings.meaningsCount || 1)))
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.meaningsCount = value;
                        await this.plugin.saveSettings();
                    }));
        } else {
            new Setting(section)
                .setName('Translations per word')
                .setDesc('Smart Auto Mode uses 2 translation alternatives (separated by -) for clarity')
                .setDisabled(true);

            new Setting(section)
                .setName('Meanings per definition')
                .setDesc('Fixed to 2 meanings per definition in Smart Auto Mode (for clarity)')
                .setDisabled(true);
        }

        if (this.plugin.settings.smartAutoMode) {
            new Setting(section)
                .setName('✨ Multi-Model Consensus')
                .setDesc('Enabled automatically in Smart Auto Mode for low-confidence results')
                .setDisabled(true)
                .addExtraButton(btn => btn
                    .setIcon('info')
                    .setTooltip('Triggers only when the first result quality is low; uses early-exit and budget guardrails.'));
        } else {
            const consensusSetting = new Setting(section)
                .setName('Enable Multi-Model Consensus')
                .setDesc('Use multiple models only when the first result looks weak')
                .addExtraButton(btn => btn
                    .setIcon('info')
                    .setTooltip('Best value: 2 models with Best Score. Use Budget per run to control extra API usage.'))
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.enableConsensus)
                    .onChange(async (value) => {
                        this.plugin.settings.enableConsensus = value;
                        await this.plugin.saveSettings();
                        this.display();
                    }));

            if (this.plugin.settings.enableConsensus) {
                new Setting(section)
                    .setName('Consensus trigger threshold')
                    .setDesc('Trigger when quality score is below this value (0.5–0.95)')
                    .addSlider(slider => slider
                        .setLimits(0.5, 0.95, 0.05)
                        .setValue(this.plugin.settings.consensusTriggerThreshold)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            this.plugin.settings.consensusTriggerThreshold = value;
                            await this.plugin.saveSettings();
                        }));

                new Setting(section)
                    .setName('Max models per word')
                    .setDesc('Maximum total models to try (including primary)')
                    .addSlider(slider => slider
                        .setLimits(2, 3, 1)
                        .setValue(this.plugin.settings.consensusMaxModels)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            this.plugin.settings.consensusMaxModels = value;
                            await this.plugin.saveSettings();
                        }));

                new Setting(section)
                    .setName('Consensus strategy')
                    .setDesc('How to select or combine results')
                    .addDropdown(dropdown => dropdown
                        .addOption('best-score', 'Best Score')
                        .addOption('merge', 'Merge')
                        .setValue(this.plugin.settings.consensusStrategy)
                        .onChange(async (value) => {
                            this.plugin.settings.consensusStrategy = value as any;
                            await this.plugin.saveSettings();
                        }));

                new Setting(section)
                    .setName('Budget per run')
                    .setDesc('Max extra API calls for consensus per session')
                    .addSlider(slider => slider
                        .setLimits(1, 30, 1)
                        .setValue(this.plugin.settings.consensusBudgetPerRun)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            this.plugin.settings.consensusBudgetPerRun = value;
                            await this.plugin.saveSettings();
                        }));
            }
        }
    }

    createBatchSettings(containerEl: HTMLElement): void {
        const section = containerEl.createEl('div', { cls: 'vocabulary-sync-setting-section' });

        section.createEl('h2', { text: '⚙️ Advanced Settings' });

        if (this.plugin.settings.smartAutoMode) {
            new Setting(section)
                .setName("✨ Smart Batch Sizing")
                .setDesc("Batch size is automatically adjusted based on translation quality and success rate. Adapts from 1-20 words per batch.")
                .setDisabled(true);
        } else {
            const batchSetting = new Setting(section)
                .setName("Words per batch")
                .setDesc("Number of words to process in each API request.")
                .addExtraButton(btn => btn
                    .setIcon('info')
                    .setTooltip('Larger batches may reduce definition/example quality in higher quality modes. Prefer smaller batches in "professional" and "comprehensive".'));

            const sliderContainer = batchSetting.controlEl.createDiv({ cls: 'vocabulary-sync-slider-container' });
            const slider = sliderContainer.createEl('input', {
                type: 'range',
                value: this.plugin.settings.batchSize.toString(),
                attr: { min: '1', max: '20', step: '1' }
            });
            const valueDisplay = sliderContainer.createEl('span', {
                cls: 'vocabulary-sync-slider-value',
                text: this.plugin.settings.batchSize.toString()
            });

            slider.addEventListener('input', async (e) => {
                const value = (e.target as HTMLInputElement).value;
                valueDisplay.textContent = value;
                this.plugin.settings.batchSize = parseInt(value);
                await this.plugin.saveSettings();
                this.plugin.updatePerformanceStats();
                const qual = this.plugin.settings.translationQuality;
                const rec = qual === 'comprehensive' ? 4 : (qual === 'professional' ? 6 : null);
                if (rec && parseInt(value) > rec) {
                    new Notice(`Warning: ${value} > recommended ${rec} for ${qual} quality. Larger batches may reduce quality.`);
                }
            });
        }

        const jsonSetting = new Setting(section)
            .setName("Enable JSON format")
            .setDesc("JSON improves parsing accuracy and reliability. When OFF, providers may still return JSON.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useJSONFormat)
                .onChange(async (value) => {
                    this.plugin.settings.useJSONFormat = value;
                    await this.plugin.saveSettings();
                }));
        jsonSetting.addExtraButton(btn => btn
            .setIcon('info')
            .setTooltip('When ON, we request JSON responses explicitly (when supported). When OFF, we accept text and try to parse gracefully.'));

        const testJsonButton = jsonSetting.controlEl.createEl('button', {
            text: 'Test JSON',
            cls: 'mod-cta'
        });
        testJsonButton.style.marginLeft = '10px';
        testJsonButton.style.padding = '6px 12px';
        testJsonButton.style.fontSize = '0.9em';

        testJsonButton.addEventListener('click', async () => {
            testJsonButton.textContent = 'Testing...';
            testJsonButton.disabled = true;
            await this.plugin.testJSONFormat();
            testJsonButton.textContent = 'Test JSON';
            testJsonButton.disabled = false;
        });

        new Setting(section)
            .setName("Enable positional fallback")
            .setDesc("If the AI omits originalWord in items, map results to input words by order. Keeps quality intact, improves robustness.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enablePositionalFallback !== false)
                .onChange(async (value) => {
                    this.plugin.settings.enablePositionalFallback = value;
                    await this.plugin.saveSettings();
                }));

        if (this.plugin.settings.smartAutoMode) {
            new Setting(section)
                .setName('Smart rate limiting')
                .setDesc('Automatically selects requests per minute based on quality and model caps.')
                .setDisabled(true)
                .addExtraButton(btn => btn
                    .setIcon('info')
                    .setTooltip('In Smart Auto Mode, RPM is chosen automatically (e.g., 30/20/12 for standard/professional/comprehensive, capped by the model).'));
        } else {
            const rateLimitSetting = new Setting(section)
                .setName("Enable rate limiting")
                .setDesc("Automatically control API request rate for stable performance")
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.enableRateLimiting)
                    .onChange(async (value) => {
                        this.plugin.settings.enableRateLimiting = value;
                        await this.plugin.saveSettings();
                        this.plugin.updatePerformanceStats();
                    }));

            if (this.plugin.settings.enableRateLimiting) {
                const rpmSetting = new Setting(section)
                    .setName("Requests per minute")
                    .setDesc("Maximum API requests per minute (requires \"Enable rate limiting\" to take effect)");
                rpmSetting.addExtraButton(btn => btn
                    .setIcon('info')
                    .setTooltip('Takes effect only when "Enable rate limiting" is ON. Limits maximum batches in any rolling 60-second window. You may see two quick batches then a pause.'));

                const rpmSliderContainer = rpmSetting.controlEl.createDiv({ cls: 'vocabulary-sync-slider-container' });
                this.rpmSlider = rpmSliderContainer.createEl('input', {
                    type: 'range',
                    value: this.plugin.settings.requestsPerMinute.toString(),
                    attr: {
                        min: '1',
                        max: this.plugin.getCurrentMaxRequests().toString(),
                        step: '1'
                    }
                });
                this.rpmValueDisplay = rpmSliderContainer.createEl('span', {
                    cls: 'vocabulary-sync-slider-value',
                    text: this.plugin.settings.requestsPerMinute.toString()
                });

                this.rpmSlider.addEventListener('input', async (e) => {
                    const value = (e.target as HTMLInputElement).value;
                    if (this.rpmValueDisplay) {
                        this.rpmValueDisplay.textContent = value;
                    }
                    this.plugin.settings.requestsPerMinute = parseInt(value);
                    await this.plugin.saveSettings();
                    this.plugin.updatePerformanceStats();
                });
            }
        }

        this.performanceStatsEl = section.createEl('div', { cls: 'vocabulary-sync-performance-stats' });
        this.updatePerformanceStats();
        new Setting(section)
            .setName('🔍 Dry Run Mode (Preview)')
            .setDesc('Enable preview mode: see what would happen without making any API calls, without file changes, and without syncing to Anki. Perfect for testing before actual processing.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.dryRun ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.dryRun = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('Enable cancel button')
            .setDesc('Allow cancelling a running operation from the status bar')
            .addExtraButton(btn => btn
                .setIcon('info')
                .setTooltip('Adds a clickable status bar indicator. Click it while a task is running to request cancellation.'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableCancelButton ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.enableCancelButton = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('Show progress notices')
            .setDesc('Show small periodic notices with progress updates during long runs')
            .addExtraButton(btn => btn
                .setIcon('info')
                .setTooltip('Displays occasional progress popups during long operations. On mobile, these are throttled to reduce noise.'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showProgressDialog ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.showProgressDialog = value;
                    await this.plugin.saveSettings();
                }));

        section.createEl('h3', { text: '📚 Incremental Learning', attr: { style: 'margin-top: 20px;' } });
        new Setting(section)
            .setName('Learner level')
            .setDesc('Adjust complexity of definitions and examples to match your proficiency')
            .addExtraButton(btn => btn.setIcon('info').setTooltip('A1-A2: simpler definitions and examples. C1-C2: nuanced notes and collocations.'))
            .addDropdown(dropdown => dropdown
                .addOption('A1', 'A1 - Beginner')
                .addOption('A2', 'A2 - Elementary')
                .addOption('B1', 'B1 - Intermediate')
                .addOption('B2', 'B2 - Upper Intermediate')
                .addOption('C1', 'C1 - Advanced')
                .addOption('C2', 'C2 - Proficient')
                .setValue(this.plugin.settings.learnerLevel)
                .onChange(async (value) => {
                    this.plugin.settings.learnerLevel = value as any;
                    if (this.plugin.settings.smartAutoMode) {
                        if (value === 'A1' || value === 'A2') {
                            this.plugin.settings.simplifyExamplesForBeginners = true;
                            this.plugin.settings.limitDefinitionLength = true;
                            this.plugin.settings.addNuanceForAdvanced = false;
                        } else if (value === 'C1' || value === 'C2') {
                            this.plugin.settings.addNuanceForAdvanced = true;
                            this.plugin.settings.simplifyExamplesForBeginners = false;
                            this.plugin.settings.limitDefinitionLength = false;
                        } else {
                            this.plugin.settings.simplifyExamplesForBeginners = false;
                            this.plugin.settings.limitDefinitionLength = false;
                            this.plugin.settings.addNuanceForAdvanced = false;
                        }
                    } else {
                        this.plugin.settings.simplifyExamplesForBeginners = false;
                        this.plugin.settings.limitDefinitionLength = false;
                        this.plugin.settings.addNuanceForAdvanced = false;
                    }
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (['A1', 'A2'].includes(this.plugin.settings.learnerLevel)) {
            new Setting(section)
                .setName('Simplify examples for beginners')
                .setDesc('Use simple vocabulary and short sentences in examples for A1-A2')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.simplifyExamplesForBeginners)
                    .onChange(async (value) => {
                        this.plugin.settings.simplifyExamplesForBeginners = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(section)
                .setName('Limit definition length for beginners')
                .setDesc('Use shorter definitions (15–30 words) for A1-A2')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.limitDefinitionLength)
                    .onChange(async (value) => {
                        this.plugin.settings.limitDefinitionLength = value;
                        await this.plugin.saveSettings();
                    }));
        }

        if (['C1', 'C2'].includes(this.plugin.settings.learnerLevel)) {
            new Setting(section)
                .setName('Add nuance for advanced')
                .setDesc('Include collocations, register notes, and nuances for C1-C2')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.addNuanceForAdvanced)
                    .onChange(async (value) => {
                        this.plugin.settings.addNuanceForAdvanced = value;
                        await this.plugin.saveSettings();
                    }));
        }

    }

    updateRpmSliderLimit(): void {
        if (this.rpmSlider) {
            const maxRequests = this.plugin.getCurrentMaxRequests();
            this.rpmSlider.max = maxRequests.toString();

            if (this.plugin.settings.requestsPerMinute > maxRequests) {
                this.plugin.settings.requestsPerMinute = maxRequests;
                this.plugin.saveSettings();
                if (this.rpmValueDisplay) {
                    this.rpmValueDisplay.textContent = maxRequests.toString();
                }
                this.rpmSlider.value = maxRequests.toString();
            }
        }
    }

    updatePerformanceStats(): void {
        if (!this.performanceStatsEl) return;

        const serviceType = "Cloudflare Worker";
        const maxRequests = this.plugin.getCurrentMaxRequests();
        const wordsPerMinute = this.plugin.settings.batchSize * this.plugin.settings.requestsPerMinute;

        this.performanceStatsEl.empty();

        const mainStats = this.performanceStatsEl.createEl('p', {
            text: `Service: ${serviceType}`,
            attr: { style: 'margin: 0; font-weight: bold; color: var(--text-accent);' }
        });

        this.performanceStatsEl.createEl('p', {
            text: `Estimated: ${wordsPerMinute} words/minute`,
            attr: { style: 'margin: 5px 0 0 0; font-size: 0.9em;' }
        });

        try {
            const { totals, avgBatchSize, successRate } = this.plugin.getUsageStats();
            this.performanceStatsEl.createEl('p', {
                text: `Processed words (lifetime): ${totals.totalWordsProcessed}`,
                attr: { style: 'margin: 6px 0 0 0; font-size: 0.9em;' }
            });
            this.performanceStatsEl.createEl('p', {
                text: `Batches: ${totals.totalBatches} (avg size: ${avgBatchSize}, success: ${successRate}%)`,
                attr: { style: 'margin: 2px 0 0 0; font-size: 0.9em;' }
            });
        } catch { }

        this.performanceStatsEl.addClass('vocabulary-sync-performance-update');
        setTimeout(() => {
            this.performanceStatsEl?.removeClass('vocabulary-sync-performance-update');
        }, 500);
    }

    createAnkiSettings(containerEl: HTMLElement): void {
        const section = containerEl.createEl('div', { cls: 'vocabulary-sync-setting-section' });

        section.createEl('h2', { text: '🎴 Anki Settings' });

        new Setting(section)
            .setName("Deck name")
            .setDesc("Target Anki deck name")
            .addExtraButton(btn => btn
                .setIcon('info')
                .setTooltip('Cards will be added to this deck. Ensure the name matches a deck in Anki.'))
            .addText(text => text
                .setPlaceholder("Default")
                .setValue(this.plugin.settings.deckName)
                .onChange(async (value) => {
                    this.plugin.settings.deckName = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName("Note type")
            .setDesc("Anki note type to use")
            .addExtraButton(btn => btn
                .setIcon('info')
                .setTooltip('Choose an Anki note type compatible with your card template and fields.'))
            .addText(text => text
                .setPlaceholder("Basic")
                .setValue(this.plugin.settings.noteType)
                .onChange(async (value) => {
                    this.plugin.settings.noteType = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName("Enable custom tags")
            .setDesc("Enable adding your own tags to Anki cards")
            .addExtraButton(btn => btn
                .setIcon('info')
                .setTooltip('When ON, the tags you specify below will be appended to every created/updated card.'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableCustomTags)
                .onChange(async (value) => {
                    this.plugin.settings.enableCustomTags = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.enableCustomTags) {
            new Setting(section)
                .setName("Custom tags")
                .setDesc("Comma-separated tags to attach to cards")
                .addExtraButton(btn => btn
                    .setIcon('info')
                    .setTooltip('Example: vocabulary, language, A2. Tags are split by commas; spaces are allowed.'))
                .addText(text => text
                    .setPlaceholder("vocabulary,language")
                    .setValue(this.plugin.settings.ankiTags)
                    .onChange(async (value) => {
                        this.plugin.settings.ankiTags = value;
                        await this.plugin.saveSettings();
                    }));
        }

        new Setting(section)
            .setName("Auto sync")
            .setDesc("Automatically sync when the vocabulary file changes")
            .addExtraButton(btn => btn
                .setIcon('info')
                .setTooltip('Watches the vocabulary file and triggers Anki sync upon edits. On large files or frequent edits, this may run often—disable if needed.'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSync)
                .onChange(async (value) => {
                    this.plugin.settings.autoSync = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName("Front warning & skip invalid")
            .setDesc("Skip rows with invalid Front and log a warning")
            .addExtraButton(btn => btn
                .setIcon('info')
                .setTooltip('Avoids creating bad cards by skipping rows with empty Front, numbers-only, or separator artifacts.'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showFrontWarning)
                .onChange(async (value) => {
                    this.plugin.settings.showFrontWarning = value;
                    await this.plugin.saveSettings();
                }));


    }

    createStyleSettings(containerEl: HTMLElement): void {
        const section = containerEl.createEl('div', { cls: 'vocabulary-sync-setting-section' });

        section.createEl('h2', { text: '🎨 Anki Card Styles' });

        this.addColumnStyleSetting(section, "Column 2 - Source Word", "column2Style", 2);
        this.addColumnStyleSetting(section, "Column 3 - Translation", "column3Style", 3);
        this.addColumnStyleSetting(section, "Column 4 - Definition", "column4Style", 4);
        this.addColumnStyleSetting(section, "Column 5 - Example", "column5Style", 5);
        this.addColumnStyleSetting(section, "Column 6 - Example Translation", "column6Style", 6);
    }

    addColumnStyleSetting(containerEl: HTMLElement, name: string, settingKey: keyof MyPluginSettings, columnIndex: number) {
        const setting = new Setting(containerEl)
            .setName(name)
            .setDesc(`Style for column ${columnIndex} in Anki cards`);

        setting.addColorPicker(cp => {
            const style = this.plugin.settings[settingKey] as ColumnStyle;
            cp.setValue(style.color)
                .onChange(async (value) => {
                    const currentStyle = this.plugin.settings[settingKey] as ColumnStyle;
                    currentStyle.color = value;
                    await this.plugin.saveSettings();
                });
        });

        setting.addDropdown(dd => {
            const style = this.plugin.settings[settingKey] as ColumnStyle;
            dd.addOption('12px', '12px')
                .addOption('14px', '14px')
                .addOption('16px', '16px')
                .addOption('18px', '18px')
                .addOption('20px', '20px')
                .setValue(style.fontSize)
                .onChange(async (value) => {
                    const currentStyle = this.plugin.settings[settingKey] as ColumnStyle;
                    currentStyle.fontSize = value;
                    await this.plugin.saveSettings();
                });
        });

        setting.addDropdown(dd => {
            const style = this.plugin.settings[settingKey] as ColumnStyle;
            dd.addOption('normal', 'Normal')
                .addOption('bold', 'Bold')
                .addOption('italic', 'Italic')
                .setValue(style.fontWeight)
                .onChange(async (value) => {
                    const currentStyle = this.plugin.settings[settingKey] as ColumnStyle;
                    currentStyle.fontWeight = value;
                    await this.plugin.saveSettings();
                });
        });
    }

    createCommands(containerEl: HTMLElement): void {
        const section = containerEl.createEl('div', { cls: 'vocabulary-sync-setting-section' });

        section.createEl('h2', { text: '⌨️ Commands' });

        const grid = section.createEl('div', { cls: 'vocabulary-sync-command-grid' });

        this.createCommandButton(grid, "Professional Processing", "Process words with AI professional translation", async () => {
            await this.plugin.startNewOperation("translation");
            await this.plugin.processWordsFileAdvanced();
        });

        this.createCommandButton(grid, "Sync with Anki", "Sync vocabulary to Anki", async () => {
            await this.plugin.startNewOperation("anki-sync");
            await this.plugin.syncWithAnki();
        });

        this.createCommandButton(grid, "Clear AI Memory", "Clear all cached AI responses immediately (in-memory + persisted)", async () => {
            await this.plugin.clearCache();
        });

        this.createCommandButton(grid, "Show Operation Summary", "Show detailed summary of current/last operation", async () => {
            const summary = this.plugin.operationSummaryManager.getCurrentSummary();
            if (summary) {
                const report = this.plugin.operationSummaryManager.generateSummaryReport(summary);
                new Notice(report, 10000);
            } else {
                new Notice("No operation in progress");
            }
        });
    }

    createCommandButton(containerEl: HTMLElement, text: string, desc: string, onClick: () => Promise<void>): void {
        const buttonContainer = containerEl.createEl('div', { cls: 'vocabulary-sync-command-item' });

        const setting = new Setting(buttonContainer)
            .setName(text)
            .setDesc(desc);

        setting.addButton(button => button
            .setButtonText("Run")
            .setCta()
            .onClick(onClick));
    }

    createSolidarityMessage(containerEl: HTMLElement): void {
        const section = containerEl.createEl('div', { cls: 'vocabulary-sync-solidarity-message' });

        section.createEl('h3', { text: '🇵🇸 Free Palestine | فلسطين حرة 🇵🇸' });
        section.createEl('p', { text: '🔻 Stand for justice and human rights 🔻' });
    }
}
