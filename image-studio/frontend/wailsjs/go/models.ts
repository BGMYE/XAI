export namespace backend {
	
	export class AppUpdateInfo {
	    currentVersion: string;
	    latestVersion: string;
	    releaseTag: string;
	    releaseName?: string;
	    releaseURL: string;
	    publishedAt?: string;
	    body?: string;
	    hasUpdate: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AppUpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.releaseTag = source["releaseTag"];
	        this.releaseName = source["releaseName"];
	        this.releaseURL = source["releaseURL"];
	        this.publishedAt = source["publishedAt"];
	        this.body = source["body"];
	        this.hasUpdate = source["hasUpdate"];
	    }
	}
	export class AppUpdateProbeResult {
	    appVersion?: string;
	    currentVersion?: string;
	    latestVersion?: string;
	    releaseTag?: string;
	    releaseURL?: string;
	    ignoredReleaseTag?: string;
	    updateInfoAvailable: boolean;
	    hasUpdate: boolean;
	    shouldShowUpdate: boolean;
	    appUpdateModalOpen: boolean;
	    capturedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new AppUpdateProbeResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.appVersion = source["appVersion"];
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.releaseTag = source["releaseTag"];
	        this.releaseURL = source["releaseURL"];
	        this.ignoredReleaseTag = source["ignoredReleaseTag"];
	        this.updateInfoAvailable = source["updateInfoAvailable"];
	        this.hasUpdate = source["hasUpdate"];
	        this.shouldShowUpdate = source["shouldShowUpdate"];
	        this.appUpdateModalOpen = source["appUpdateModalOpen"];
	        this.capturedAt = source["capturedAt"];
	    }
	}
	export class BatchInputImage {
	    path: string;
	    name: string;
	    size: number;
	    width?: number;
	    height?: number;
	    previewUrl?: string;
	    previewWidth?: number;
	    previewHeight?: number;
	
	    static createFrom(source: any = {}) {
	        return new BatchInputImage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.previewUrl = source["previewUrl"];
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	    }
	}
	export class BatchInputDirectory {
	    directory: string;
	    images: BatchInputImage[];
	
	    static createFrom(source: any = {}) {
	        return new BatchInputDirectory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.directory = source["directory"];
	        this.images = this.convertValues(source["images"], BatchInputImage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class CodexAPIConfig {
	    provider: string;
	    baseURL: string;
	    apiKey: string;
	    wireAPI: string;
	
	    static createFrom(source: any = {}) {
	        return new CodexAPIConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.baseURL = source["baseURL"];
	        this.apiKey = source["apiKey"];
	        this.wireAPI = source["wireAPI"];
	    }
	}
	export class FallbackProfileOptions {
	    baseURL: string;
	    apiKey: string;
	    textModelID: string;
	    imageModelID: string;
	    reasoningEffort: string;
	    apiMode: string;
	    responsesTransport?: string;
	    requestPolicy: string;
	    imagesNewAPICompat?: boolean;
	    allowInsecureConnection?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FallbackProfileOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.baseURL = source["baseURL"];
	        this.apiKey = source["apiKey"];
	        this.textModelID = source["textModelID"];
	        this.imageModelID = source["imageModelID"];
	        this.reasoningEffort = source["reasoningEffort"];
	        this.apiMode = source["apiMode"];
	        this.responsesTransport = source["responsesTransport"];
	        this.requestPolicy = source["requestPolicy"];
	        this.imagesNewAPICompat = source["imagesNewAPICompat"];
	        this.allowInsecureConnection = source["allowInsecureConnection"];
	    }
	}
	export class GenerateOptions {
	    apiKey: string;
	    mode: string;
	    requestedJobId: string;
	    prompt: string;
	    size: string;
	    quality: string;
	    outputFormat: string;
	    imagePaths: string[];
	    imagePath: string;
	    maskB64: string;
	    seed: number;
	    negativePrompt: string;
	    background: string;
	    outputCompression: number;
	    inputFidelity: string;
	    imageStyle: string;
	    moderation: string;
	    userIdentifier: string;
	    baseURL: string;
	    textModelID: string;
	    imageModelID: string;
	    reasoningEffort: string;
	    apiMode: string;
	    responsesTransport?: string;
	    requestPolicy: string;
	    imagesNewAPICompat?: boolean;
	    allowInsecureConnection?: boolean;
	    proxyMode: string;
	    proxyURL: string;
	    noPromptRevision: boolean;
	    concurrencyLimit: number;
	    partialImages: number;
	    disablePreview?: boolean;
	    autoRetryEnabled: boolean;
	    autoRetryCount: number;
	    fallbackProfile?: FallbackProfileOptions;
	
	    static createFrom(source: any = {}) {
	        return new GenerateOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiKey = source["apiKey"];
	        this.mode = source["mode"];
	        this.requestedJobId = source["requestedJobId"];
	        this.prompt = source["prompt"];
	        this.size = source["size"];
	        this.quality = source["quality"];
	        this.outputFormat = source["outputFormat"];
	        this.imagePaths = source["imagePaths"];
	        this.imagePath = source["imagePath"];
	        this.maskB64 = source["maskB64"];
	        this.seed = source["seed"];
	        this.negativePrompt = source["negativePrompt"];
	        this.background = source["background"];
	        this.outputCompression = source["outputCompression"];
	        this.inputFidelity = source["inputFidelity"];
	        this.imageStyle = source["imageStyle"];
	        this.moderation = source["moderation"];
	        this.userIdentifier = source["userIdentifier"];
	        this.baseURL = source["baseURL"];
	        this.textModelID = source["textModelID"];
	        this.imageModelID = source["imageModelID"];
	        this.reasoningEffort = source["reasoningEffort"];
	        this.apiMode = source["apiMode"];
	        this.responsesTransport = source["responsesTransport"];
	        this.requestPolicy = source["requestPolicy"];
	        this.imagesNewAPICompat = source["imagesNewAPICompat"];
	        this.allowInsecureConnection = source["allowInsecureConnection"];
	        this.proxyMode = source["proxyMode"];
	        this.proxyURL = source["proxyURL"];
	        this.noPromptRevision = source["noPromptRevision"];
	        this.concurrencyLimit = source["concurrencyLimit"];
	        this.partialImages = source["partialImages"];
	        this.disablePreview = source["disablePreview"];
	        this.autoRetryEnabled = source["autoRetryEnabled"];
	        this.autoRetryCount = source["autoRetryCount"];
	        this.fallbackProfile = this.convertValues(source["fallbackProfile"], FallbackProfileOptions);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ImageTransformResult {
	    path: string;
	    acceleration?: string;
	
	    static createFrom(source: any = {}) {
	        return new ImageTransformResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.acceleration = source["acceleration"];
	    }
	}
	export class ImportedImage {
	    path: string;
	    imageB64?: string;
	    imageId?: string;
	    previewUrl?: string;
	    previewWidth?: number;
	    previewHeight?: number;
	
	    static createFrom(source: any = {}) {
	        return new ImportedImage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.imageB64 = source["imageB64"];
	        this.imageId = source["imageId"];
	        this.previewUrl = source["previewUrl"];
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	    }
	}
	export class JobStarted {
	    jobId: string;
	
	    static createFrom(source: any = {}) {
	        return new JobStarted(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.jobId = source["jobId"];
	    }
	}
	export class MediaAssetRef {
	    imageId?: string;
	    savedPath?: string;
	    thumbPath?: string;
	    previewUrl?: string;
	    fullUrl?: string;
	    previewWidth?: number;
	    previewHeight?: number;
	
	    static createFrom(source: any = {}) {
	        return new MediaAssetRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.imageId = source["imageId"];
	        this.savedPath = source["savedPath"];
	        this.thumbPath = source["thumbPath"];
	        this.previewUrl = source["previewUrl"];
	        this.fullUrl = source["fullUrl"];
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	    }
	}
	export class ProbeUpstreamOptions {
	    apiKey: string;
	    baseURL: string;
	    proxyMode: string;
	    proxyURL: string;
	    apiMode?: string;
	    responsesTransport?: string;
	    allowInsecureConnection?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ProbeUpstreamOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiKey = source["apiKey"];
	        this.baseURL = source["baseURL"];
	        this.proxyMode = source["proxyMode"];
	        this.proxyURL = source["proxyURL"];
	        this.apiMode = source["apiMode"];
	        this.responsesTransport = source["responsesTransport"];
	        this.allowInsecureConnection = source["allowInsecureConnection"];
	    }
	}
	export class UpstreamModelDescriptor {
	    id: string;
	    object?: string;
	    ownedBy?: string;
	    displayName?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpstreamModelDescriptor(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.object = source["object"];
	        this.ownedBy = source["ownedBy"];
	        this.displayName = source["displayName"];
	    }
	}
	export class ProbeUpstreamResult {
	    modelCount: number;
	    models?: UpstreamModelDescriptor[];
	    responsesTransport?: string;
	    responsesTransportOK?: boolean;
	    responsesTransportError?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProbeUpstreamResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.modelCount = source["modelCount"];
	        this.models = this.convertValues(source["models"], UpstreamModelDescriptor);
	        this.responsesTransport = source["responsesTransport"];
	        this.responsesTransportOK = source["responsesTransportOK"];
	        this.responsesTransportError = source["responsesTransportError"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PromptImportActivation {
	    tokens?: string[];
	    invalidCount?: number;
	
	    static createFrom(source: any = {}) {
	        return new PromptImportActivation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tokens = source["tokens"];
	        this.invalidCount = source["invalidCount"];
	    }
	}
	export class PromptImportBilingualText {
	    zh?: string;
	    en?: string;
	
	    static createFrom(source: any = {}) {
	        return new PromptImportBilingualText(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.zh = source["zh"];
	        this.en = source["en"];
	    }
	}
	export class PromptImportPayload {
	    prompt: PromptImportBilingualText;
	    negative_prompt?: PromptImportBilingualText;
	    aspect_ratio?: string;
	    resolvedSize?: string;
	
	    static createFrom(source: any = {}) {
	        return new PromptImportPayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.prompt = this.convertValues(source["prompt"], PromptImportBilingualText);
	        this.negative_prompt = this.convertValues(source["negative_prompt"], PromptImportBilingualText);
	        this.aspect_ratio = source["aspect_ratio"];
	        this.resolvedSize = source["resolvedSize"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PromptOptimizeOptions {
	    apiKey: string;
	    prompt: string;
	    mode: string;
	    baseURL: string;
	    textModelID: string;
	    proxyMode: string;
	    proxyURL: string;
	    allowInsecureConnection?: boolean;
	    imagePaths: string[];
	    imagePath: string;
	
	    static createFrom(source: any = {}) {
	        return new PromptOptimizeOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiKey = source["apiKey"];
	        this.prompt = source["prompt"];
	        this.mode = source["mode"];
	        this.baseURL = source["baseURL"];
	        this.textModelID = source["textModelID"];
	        this.proxyMode = source["proxyMode"];
	        this.proxyURL = source["proxyURL"];
	        this.allowInsecureConnection = source["allowInsecureConnection"];
	        this.imagePaths = source["imagePaths"];
	        this.imagePath = source["imagePath"];
	    }
	}
	export class SelectFileResponse {
	    path: string;
	    size: number;
	    imageB64?: string;
	    imageId?: string;
	    previewUrl?: string;
	    previewWidth?: number;
	    previewHeight?: number;
	
	    static createFrom(source: any = {}) {
	        return new SelectFileResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.size = source["size"];
	        this.imageB64 = source["imageB64"];
	        this.imageId = source["imageId"];
	        this.previewUrl = source["previewUrl"];
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	    }
	}
	export class SelectFilesResponse {
	    files: BatchInputImage[];
	
	    static createFrom(source: any = {}) {
	        return new SelectFilesResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = this.convertValues(source["files"], BatchInputImage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UpscaleResult {
	    path: string;
	    acceleration: string;
	    width: number;
	    height: number;
	    mediaAssetRef: MediaAssetRef;
	
	    static createFrom(source: any = {}) {
	        return new UpscaleResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.acceleration = source["acceleration"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.mediaAssetRef = this.convertValues(source["mediaAssetRef"], MediaAssetRef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class VideoOptions {
	    baseURL: string;
	    apiKey: string;
	    videoModelID: string;
	    endpointPath?: string;
	    prompt: string;
	    seconds?: number;
	    size?: string;
	    quality?: string;
	
	    static createFrom(source: any = {}) {
	        return new VideoOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.baseURL = source["baseURL"];
	        this.apiKey = source["apiKey"];
	        this.videoModelID = source["videoModelID"];
	        this.endpointPath = source["endpointPath"];
	        this.prompt = source["prompt"];
	        this.seconds = source["seconds"];
	        this.size = source["size"];
	        this.quality = source["quality"];
	    }
	}
	export class VideoPollOptions {
	    baseURL: string;
	    apiKey: string;
	    videoID: string;
	    endpointPath?: string;
	
	    static createFrom(source: any = {}) {
	        return new VideoPollOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.baseURL = source["baseURL"];
	        this.apiKey = source["apiKey"];
	        this.videoID = source["videoID"];
	        this.endpointPath = source["endpointPath"];
	    }
	}
	export class VideoResult {
	    id: string;
	    status: string;
	    url?: string;
	    b64_json?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new VideoResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.status = source["status"];
	        this.url = source["url"];
	        this.b64_json = source["b64_json"];
	        this.error = source["error"];
	    }
	}

}

export namespace compat {
	
	export class AdvancedFloatingPanelPrefs {
	    x?: number;
	    y?: number;
	    groups?: Record<string, boolean>;
	
	    static createFrom(source: any = {}) {
	        return new AdvancedFloatingPanelPrefs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.groups = source["groups"];
	    }
	}
	export class CompletionNotificationSettings {
	    enabled?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CompletionNotificationSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	    }
	}
	export class CompletionSoundSettings {
	    enabled?: boolean;
	    mode?: string;
	    customName?: string;
	    customDataURL?: string;
	
	    static createFrom(source: any = {}) {
	        return new CompletionSoundSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.mode = source["mode"];
	        this.customName = source["customName"];
	        this.customDataURL = source["customDataURL"];
	    }
	}
	export class CustomAspectRatio {
	    id: string;
	    label: string;
	    width: number;
	    height: number;
	    createdAt: number;
	
	    static createFrom(source: any = {}) {
	        return new CustomAspectRatio(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class HistoryFullItem {
	    id: string;
	    imageB64: string;
	
	    static createFrom(source: any = {}) {
	        return new HistoryFullItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.imageB64 = source["imageB64"];
	    }
	}
	export class HistoryItem {
	    id: string;
	    imageId?: string;
	    previewUrl?: string;
	    fullUrl?: string;
	    previewPath?: string;
	    thumbPath?: string;
	    previewWidth?: number;
	    previewHeight?: number;
	    imageB64?: string;
	    previewOnly?: boolean;
	    prompt: string;
	    revisedPrompt?: string;
	    mode: string;
	    size: string;
	    quality: string;
	    outputFormat?: string;
	    parentId?: string;
	    createdAt: number;
	    seed?: number;
	    negativePrompt?: string;
	    background?: string;
	    outputCompression?: number;
	    inputFidelity?: string;
	    imageStyle?: string;
	    moderation?: string;
	    styleTag?: string;
	    batchIndex?: number;
	    previewSlotIndex?: number;
	    elapsedSec?: number;
	    sourcePaths?: string[];
	    savedPath?: string;
	    rawPath?: string;
	
	    static createFrom(source: any = {}) {
	        return new HistoryItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.imageId = source["imageId"];
	        this.previewUrl = source["previewUrl"];
	        this.fullUrl = source["fullUrl"];
	        this.previewPath = source["previewPath"];
	        this.thumbPath = source["thumbPath"];
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	        this.imageB64 = source["imageB64"];
	        this.previewOnly = source["previewOnly"];
	        this.prompt = source["prompt"];
	        this.revisedPrompt = source["revisedPrompt"];
	        this.mode = source["mode"];
	        this.size = source["size"];
	        this.quality = source["quality"];
	        this.outputFormat = source["outputFormat"];
	        this.parentId = source["parentId"];
	        this.createdAt = source["createdAt"];
	        this.seed = source["seed"];
	        this.negativePrompt = source["negativePrompt"];
	        this.background = source["background"];
	        this.outputCompression = source["outputCompression"];
	        this.inputFidelity = source["inputFidelity"];
	        this.imageStyle = source["imageStyle"];
	        this.moderation = source["moderation"];
	        this.styleTag = source["styleTag"];
	        this.batchIndex = source["batchIndex"];
	        this.previewSlotIndex = source["previewSlotIndex"];
	        this.elapsedSec = source["elapsedSec"];
	        this.sourcePaths = source["sourcePaths"];
	        this.savedPath = source["savedPath"];
	        this.rawPath = source["rawPath"];
	    }
	}
	export class Preset {
	    id: string;
	    name: string;
	    size: string;
	    quality: string;
	    outputFormat?: string;
	    negativePrompt: string;
	    background?: string;
	    outputCompression?: number;
	    inputFidelity?: string;
	    imageStyle?: string;
	    moderation?: string;
	    styleTag?: string;
	    editAutoAspectResolution?: string;
	    kernelRuntimeMode?: string;
	    batchCount: number;
	
	    static createFrom(source: any = {}) {
	        return new Preset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.quality = source["quality"];
	        this.outputFormat = source["outputFormat"];
	        this.negativePrompt = source["negativePrompt"];
	        this.background = source["background"];
	        this.outputCompression = source["outputCompression"];
	        this.inputFidelity = source["inputFidelity"];
	        this.imageStyle = source["imageStyle"];
	        this.moderation = source["moderation"];
	        this.styleTag = source["styleTag"];
	        this.editAutoAspectResolution = source["editAutoAspectResolution"];
	        this.kernelRuntimeMode = source["kernelRuntimeMode"];
	        this.batchCount = source["batchCount"];
	    }
	}
	export class PromptTemplate {
	    id: string;
	    label: string;
	    text: string;
	    createdAt: number;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new PromptTemplate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.text = source["text"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class Settings {
	    proxyMode?: string;
	    proxyURL?: string;
	    theme?: string;
	    fontScale?: number;
	    outputFormat?: string;
	    background?: string;
	    outputCompression?: number;
	    inputFidelity?: string;
	    imageStyle?: string;
	    moderation?: string;
	    userIdentifier?: string;
	    partialImages?: number;
	    protectStreamPreview?: boolean;
	    autoRetryEnabled?: boolean;
	    autoRetryCount?: number;
	    promptTemplates?: PromptTemplate[];
	    outputDir?: string;
	    promptHistory?: string[];
	    presets?: Preset[];
	    customAspectRatios?: CustomAspectRatio[];
	    kernelRuntimeMode?: string;
	    reducedEffects?: boolean;
	    trustedOutputRoots?: string[];
	    savePromptSuppressed?: boolean;
	    keepLogs?: boolean;
	    cleanupPreviewCacheOnExit?: boolean;
	    ignoredReleaseTag?: string;
	    completionSound?: CompletionSoundSettings;
	    completionNotification?: CompletionNotificationSettings;
	    advancedFloatingPanel?: AdvancedFloatingPanelPrefs;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.proxyMode = source["proxyMode"];
	        this.proxyURL = source["proxyURL"];
	        this.theme = source["theme"];
	        this.fontScale = source["fontScale"];
	        this.outputFormat = source["outputFormat"];
	        this.background = source["background"];
	        this.outputCompression = source["outputCompression"];
	        this.inputFidelity = source["inputFidelity"];
	        this.imageStyle = source["imageStyle"];
	        this.moderation = source["moderation"];
	        this.userIdentifier = source["userIdentifier"];
	        this.partialImages = source["partialImages"];
	        this.protectStreamPreview = source["protectStreamPreview"];
	        this.autoRetryEnabled = source["autoRetryEnabled"];
	        this.autoRetryCount = source["autoRetryCount"];
	        this.promptTemplates = this.convertValues(source["promptTemplates"], PromptTemplate);
	        this.outputDir = source["outputDir"];
	        this.promptHistory = source["promptHistory"];
	        this.presets = this.convertValues(source["presets"], Preset);
	        this.customAspectRatios = this.convertValues(source["customAspectRatios"], CustomAspectRatio);
	        this.kernelRuntimeMode = source["kernelRuntimeMode"];
	        this.reducedEffects = source["reducedEffects"];
	        this.trustedOutputRoots = source["trustedOutputRoots"];
	        this.savePromptSuppressed = source["savePromptSuppressed"];
	        this.keepLogs = source["keepLogs"];
	        this.cleanupPreviewCacheOnExit = source["cleanupPreviewCacheOnExit"];
	        this.ignoredReleaseTag = source["ignoredReleaseTag"];
	        this.completionSound = this.convertValues(source["completionSound"], CompletionSoundSettings);
	        this.completionNotification = this.convertValues(source["completionNotification"], CompletionNotificationSettings);
	        this.advancedFloatingPanel = this.convertValues(source["advancedFloatingPanel"], AdvancedFloatingPanelPrefs);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UpstreamProfile {
	    id: string;
	    name: string;
	    apiMode: string;
	    responsesTransport?: string;
	    requestPolicy: string;
	    imagesNewAPICompat?: boolean;
	    allowInsecureConnection?: boolean;
	    baseURL: string;
	    textModelID: string;
	    imageModelID: string;
	    reasoningEffort: string;
	    concurrencyLimit: number;
	    fallbackProfileId?: string;
	    createdAt: number;
	    lastUsedAt?: number;
	
	    static createFrom(source: any = {}) {
	        return new UpstreamProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.apiMode = source["apiMode"];
	        this.responsesTransport = source["responsesTransport"];
	        this.requestPolicy = source["requestPolicy"];
	        this.imagesNewAPICompat = source["imagesNewAPICompat"];
	        this.allowInsecureConnection = source["allowInsecureConnection"];
	        this.baseURL = source["baseURL"];
	        this.textModelID = source["textModelID"];
	        this.imageModelID = source["imageModelID"];
	        this.reasoningEffort = source["reasoningEffort"];
	        this.concurrencyLimit = source["concurrencyLimit"];
	        this.fallbackProfileId = source["fallbackProfileId"];
	        this.createdAt = source["createdAt"];
	        this.lastUsedAt = source["lastUsedAt"];
	    }
	}
	export class State {
	    schemaVersion: number;
	    client?: string;
	    updatedAt: number;
	    settings: Settings;
	    profiles: UpstreamProfile[];
	    activeProfileId: string;
	    history: HistoryItem[];
	    historyFull?: HistoryFullItem[];
	
	    static createFrom(source: any = {}) {
	        return new State(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schemaVersion = source["schemaVersion"];
	        this.client = source["client"];
	        this.updatedAt = source["updatedAt"];
	        this.settings = this.convertValues(source["settings"], Settings);
	        this.profiles = this.convertValues(source["profiles"], UpstreamProfile);
	        this.activeProfileId = source["activeProfileId"];
	        this.history = this.convertValues(source["history"], HistoryItem);
	        this.historyFull = this.convertValues(source["historyFull"], HistoryFullItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

