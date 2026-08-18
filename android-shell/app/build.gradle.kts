plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.OutputDirectory

val frontendRoot = file("../../image-studio/frontend")
val npmCacheDir = rootProject.file("../.tmp/android-npm-cache")
val androidHomeDir = rootProject.file("../.tmp/android-home")
val androidHomeCacheDir = androidHomeDir.resolve(".android")
val frontendNodeModules = frontendRoot.resolve("node_modules")
val fallbackDebugKeystore = androidHomeCacheDir.resolve("debug.keystore")
val customKeystorePath = providers.environmentVariable("IMAGE_STUDIO_KEYSTORE_PATH")
val appVersionName = providers.environmentVariable("IMAGE_STUDIO_ANDROID_VERSION_NAME").orElse("0.1.5-dev")
val appVersionCode = providers.environmentVariable("IMAGE_STUDIO_ANDROID_VERSION_CODE").orElse("1050001").map(String::toInt)
val usePrebuiltFrontend = providers.environmentVariable("IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND")
    .map { value -> value == "1" || value.equals("true", ignoreCase = true) }
    .orElse(false)
val ensureFallbackDebugKeystore = tasks.register("ensureFallbackDebugKeystore") {
    group = "build setup"
    outputs.file(fallbackDebugKeystore)
    doLast {
        androidHomeCacheDir.mkdirs()
        if (fallbackDebugKeystore.exists()) return@doLast
        val javaHome = System.getenv("JAVA_HOME") ?: System.getProperty("java.home")
        val keytool = file(javaHome).resolve("bin/keytool").absolutePath
        exec {
            commandLine(
                keytool,
                "-genkeypair",
                "-v",
                "-keystore",
                fallbackDebugKeystore.absolutePath,
                "-storepass",
                "android",
                "-alias",
                "androiddebugkey",
                "-keypass",
                "android",
                "-keyalg",
                "RSA",
                "-keysize",
                "2048",
                "-validity",
                "10000",
                "-dname",
                "CN=Android Debug,O=Android,C=US",
            )
        }
    }
}
val frontendInstallTask = tasks.register("prepareFrontendDependencies") {
    group = "frontend"
    inputs.file(frontendRoot.resolve("package.json"))
    inputs.file(frontendRoot.resolve("package-lock.json"))
    outputs.dir(frontendRoot.resolve("node_modules"))
    onlyIf {
        !usePrebuiltFrontend.get()
    }
    doLast {
        exec {
            workingDir = frontendRoot
            environment("npm_config_cache", npmCacheDir.absolutePath)
            environment("ANDROID_USER_HOME", androidHomeCacheDir.absolutePath)
            environment("HOME", androidHomeDir.absolutePath)
            commandLine("npm", "ci")
        }
    }
}

abstract class SyncFrontendAssetsTask : DefaultTask() {
    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty
}

android {
    namespace = "top.gptcodex.imagestudio.android"
    compileSdk = 34
    buildToolsVersion = "34.0.0"

    signingConfigs {
        getByName("debug") {
            storeFile = fallbackDebugKeystore
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
            enableV1Signing = true
            enableV2Signing = true
        }
        create("release") {
            storeFile = customKeystorePath
                .map(::file)
                .orElse(fallbackDebugKeystore)
                .get()
            storePassword = providers.environmentVariable("IMAGE_STUDIO_KEYSTORE_PASSWORD").orElse("android").get()
            keyAlias = providers.environmentVariable("IMAGE_STUDIO_KEY_ALIAS").orElse("androiddebugkey").get()
            keyPassword = providers.environmentVariable("IMAGE_STUDIO_KEY_PASSWORD").orElse("android").get()
            enableV1Signing = true
            enableV2Signing = true
        }
    }

    defaultConfig {
        applicationId = "top.gptcodex.imagestudio.android"
        minSdk = 28
        targetSdk = 34
        versionCode = appVersionCode.get()
        versionName = appVersionName.get()
        manifestPlaceholders["appLabel"] = "Image Studio Android"
        buildConfigField("String", "TARGET_PLATFORM", "\"android\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (customKeystorePath.isPresent) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

androidComponents {
    onVariants(selector().all()) { variant ->
        val mode = "android"
        val frontendTaskName = "sync${variant.name.replaceFirstChar { it.uppercaseChar() }}FrontendAssets"
        val frontendDist = frontendRoot.resolve("dist")
        val sharedAssetsDir = layout.projectDirectory.dir("src/main/assets/web")
        val generatedAssetsDir = layout.buildDirectory.dir("generated/assets/${frontendTaskName}")
        val variantCapName = variant.name.replaceFirstChar { it.uppercaseChar() }

        val syncTask = tasks.register<SyncFrontendAssetsTask>(frontendTaskName) {
            group = "frontend"
            dependsOn(frontendInstallTask)
            outputDir.set(generatedAssetsDir)
            inputs.dir(frontendRoot.resolve("src"))
            inputs.file(frontendRoot.resolve("package.json"))
            inputs.file(frontendRoot.resolve("package-lock.json"))
            inputs.file(frontendRoot.resolve("vite.config.ts"))
            inputs.file(frontendRoot.resolve("scripts/platform-vite.mjs"))
            outputs.upToDateWhen { false }
            doLast {
                androidHomeCacheDir.mkdirs()
                if (!usePrebuiltFrontend.get()) {
                    exec {
                        workingDir = frontendRoot
                        environment("npm_config_cache", npmCacheDir.absolutePath)
                        environment("ANDROID_USER_HOME", androidHomeCacheDir.absolutePath)
                        environment("HOME", androidHomeDir.absolutePath)
                        commandLine("npm", "run", "build:$mode")
                    }
                }
                if (!frontendDist.resolve("index.html").isFile) {
                    throw GradleException("Frontend dist is missing. Run npm run build:$mode or unset IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND.")
                }
                delete(sharedAssetsDir)
                delete(outputDir)
                copy {
                    from(frontendDist)
                    into(outputDir)
                }
            }
        }

        variant.sources.assets?.addGeneratedSourceDirectory(
            syncTask,
            SyncFrontendAssetsTask::outputDir,
        )

        afterEvaluate {
            listOf(
                "validateSigning${variantCapName}",
            ).forEach { taskName ->
                tasks.findByName(taskName)?.dependsOn(syncTask)
            }
            tasks.findByName("validateSigning${variantCapName}")?.dependsOn(ensureFallbackDebugKeystore)
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
