# Keep JavascriptInterface methods callable from WebView.
-keepclassmembers class top.gptcodex.imagestudio.android.** {
    @android.webkit.JavascriptInterface <methods>;
}
