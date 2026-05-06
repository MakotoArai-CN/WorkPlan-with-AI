import { spawnSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const VERSION_FILE = 'VERSION';
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const ANDROID_PERMISSIONS = [
    '<uses-permission android:name="android.permission.INTERNET" />',
    '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />',
    '<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />',
    '<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />',
    '<uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />',
    '<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />'
];

function isAscii(value) {
    return /^[\x00-\x7F]*$/.test(value);
}

function readVersionFile() {
    const file = join(process.cwd(), VERSION_FILE);
    if (!existsSync(file)) {
        throw new Error(`Missing ${VERSION_FILE}.`);
    }

    const version = readFileSync(file, 'utf8').trim();
    if (!VERSION_PATTERN.test(version)) {
        throw new Error(`${VERSION_FILE} must contain a valid semver version, got "${version}".`);
    }

    return version;
}

function androidVersionCode(version) {
    const [major, minor, patch] = version.split(/[+-]/)[0].split('.').map(Number);
    return major * 1_000_000 + minor * 1_000 + patch;
}

function updateJsonFile(file, update) {
    if (!existsSync(file)) return false;

    const current = readFileSync(file, 'utf8');
    const data = JSON.parse(current);
    update(data);
    const next = `${JSON.stringify(data, null, 2)}\n`;
    if (current === next) return false;

    writeFileSync(file, next);
    return true;
}

function replaceRequired(file, pattern, replacement) {
    if (!existsSync(file)) return false;

    const current = readFileSync(file, 'utf8');
    if (!pattern.test(current)) {
        throw new Error(`Unable to update ${file}.`);
    }

    const next = current.replace(pattern, replacement);
    if (current === next) return false;

    writeFileSync(file, next);
    return true;
}

function syncAndroidTauriProperties(file, version, versionCode) {
    if (!existsSync(file)) return false;

    let next = readFileSync(file, 'utf8');
    next = next.replace(/^tauri\.android\.versionName=.*$/m, `tauri.android.versionName=${version}`);
    next = next.replace(/^tauri\.android\.versionCode=.*$/m, `tauri.android.versionCode=${versionCode}`);
    return writeIfChanged(file, next);
}

export function syncVersionFromFile({ silent = false } = {}) {
    const version = readVersionFile();
    const versionCode = androidVersionCode(version);
    const changed = [];

    if (updateJsonFile(join(process.cwd(), 'package.json'), data => { data.version = version; })) {
        changed.push('package.json');
    }

    if (updateJsonFile(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), data => { data.version = version; })) {
        changed.push('src-tauri/tauri.conf.json');
    }

    if (replaceRequired(
        join(process.cwd(), 'src-tauri', 'Cargo.toml'),
        /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
        `$1${version}$2`
    )) {
        changed.push('src-tauri/Cargo.toml');
    }

    if (replaceRequired(
        join(process.cwd(), 'src-tauri', 'Cargo.lock'),
        /(\[\[package\]\]\r?\nname = "workplan"\r?\nversion = ")[^"]+(")/,
        `$1${version}$2`
    )) {
        changed.push('src-tauri/Cargo.lock');
    }

    if (syncAndroidTauriProperties(
        join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'tauri.properties'),
        version,
        versionCode
    )) {
        changed.push('generated Android tauri.properties');
    }

    if (!silent) {
        const details = changed.length > 0 ? changed.join(', ') : 'already synced';
        console.log(`[version] ${version} (${versionCode}) -> ${details}`);
    }

    return { version, versionCode, changed };
}

const ANDROID_MAIN_ACTIVITY = `package com.makotoarai.workplan

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var backPressedCallback: OnBackPressedCallback? = null
  private var backInvokedCallback: OnBackInvokedCallback? = null
  private var pendingBackDispatches = 0

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(WorkPlanAndroidBridge(this), "WorkPlanAndroid")
    flushPendingBackDispatches()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    installBackHandlers()
  }

  override fun onResume() {
    super.onResume()
    installBackHandlers()
    flushPendingBackDispatches()
  }

  @Deprecated("Deprecated in AndroidX Activity")
  override fun onBackPressed() {
    dispatchBackToWeb()
  }

  private fun installBackHandlers() {
    if (backPressedCallback == null) {
      val callback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          dispatchBackToWeb()
        }
      }
      backPressedCallback = callback
      onBackPressedDispatcher.addCallback(this, callback)
    } else {
      backPressedCallback?.isEnabled = true
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (backInvokedCallback == null) {
        val callback = OnBackInvokedCallback { dispatchBackToWeb() }
        backInvokedCallback = callback
        onBackInvokedDispatcher.registerOnBackInvokedCallback(
          OnBackInvokedDispatcher.PRIORITY_OVERLAY,
          callback
        )
      }
    }
  }

  override fun onDestroy() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      backInvokedCallback?.let {
        onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it)
      }
      backInvokedCallback = null
    }
    super.onDestroy()
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != DIRECTORY_PICKER_REQUEST) return

    val uri = if (resultCode == Activity.RESULT_OK) data?.data else null
    if (uri != null) {
      val flags = data?.flags ?: 0
      val takeFlags = flags and (
        Intent.FLAG_GRANT_READ_URI_PERMISSION or
          Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
      if (takeFlags != 0) {
        runCatching {
          contentResolver.takePersistableUriPermission(uri, takeFlags)
        }
      }
    }

    val payload = JSONObject().put("uri", uri?.toString() ?: "").toString()
    webView?.post {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('workplan-android-directory-picked', { detail: $payload }));",
        null
      )
    }
  }

  fun openDirectoryPicker() {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
    }
    startActivityForResult(intent, DIRECTORY_PICKER_REQUEST)
  }

  private fun dispatchBackToWeb() {
    val target = webView
    if (target == null) {
      pendingBackDispatches += 1
      return
    }
    target.post {
      target.evaluateJavascript(
        """
          (() => {
            const eventHandled = !window.dispatchEvent(
              new CustomEvent('workplan-android-back', { cancelable: true })
            );
            if (eventHandled) {
              return;
            }
            if (typeof window.__workplanAndroidBack === 'function') {
              window.__workplanAndroidBack();
            } else {
              window.__workplanPendingAndroidBack = (window.__workplanPendingAndroidBack || 0) + 1;
              window.dispatchEvent(new CustomEvent('androidbackbutton'));
            }
          })();
        """.trimIndent(),
        null
      )
    }
  }

  private fun flushPendingBackDispatches() {
    if (pendingBackDispatches <= 0 || webView == null) return
    val count = pendingBackDispatches.coerceAtMost(3)
    pendingBackDispatches = 0
    repeat(count) {
      dispatchBackToWeb()
    }
  }

  private fun storagePermissions(): Array<String> {
    return when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.READ_MEDIA_VIDEO,
        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
        Manifest.permission.READ_MEDIA_AUDIO
      )
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.READ_MEDIA_VIDEO,
        Manifest.permission.READ_MEDIA_AUDIO
      )
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.M -> {
        val requested = mutableListOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
          requested.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
        requested.toTypedArray()
      }
      else -> emptyArray()
    }
  }

  fun getStoragePermissionStatus(): JSONObject {
    val permissions = storagePermissions()
    val missing = permissions.filter {
      ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
    }
    val partial = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
      ContextCompat.checkSelfPermission(
        this,
        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
      ) == PackageManager.PERMISSION_GRANTED
    return JSONObject()
      .put("granted", missing.isEmpty() || partial)
      .put("partial", partial && missing.isNotEmpty())
      .put("missing", JSONArray(missing))
  }

  fun requestStoragePermissionsIfNeeded() {
    val permissions = storagePermissions()

    val missing = permissions.filter {
      ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
    }

    if (missing.isNotEmpty()) {
      ActivityCompat.requestPermissions(this, missing.toTypedArray(), STORAGE_PERMISSION_REQUEST)
    }
  }

  companion object {
    private const val STORAGE_PERMISSION_REQUEST = 4101
    private const val DIRECTORY_PICKER_REQUEST = 4102
  }
}

class WorkPlanAndroidBridge(private val activity: MainActivity) {
  @JavascriptInterface
  fun requestStoragePermissions() {
    activity.runOnUiThread {
      activity.requestStoragePermissionsIfNeeded()
    }
  }

  @JavascriptInterface
  fun getStoragePermissionStatus(): String {
    return wrapJson {
      activity.getStoragePermissionStatus()
    }
  }

  @JavascriptInterface
  fun openDirectoryPicker() {
    activity.runOnUiThread {
      activity.openDirectoryPicker()
    }
  }

  @JavascriptInterface
  fun searchTree(rootUri: String, query: String, maxResults: Int): String {
    return wrapJson {
      val root = DocumentFile.fromTreeUri(activity, Uri.parse(rootUri))
        ?: error("Unable to open authorized directory")
      val entries = JSONArray()
      walk(root, "", query.trim().lowercase(), maxResults.coerceIn(1, 200), entries)
      JSONObject().put("entries", entries)
    }
  }

  @JavascriptInterface
  fun searchTreeInTree(rootUri: String, relativeRoot: String, query: String, maxResults: Int): String {
    return wrapJson {
      val root = if (relativeRoot.isBlank()) {
        DocumentFile.fromTreeUri(activity, Uri.parse(rootUri))
      } else {
        resolveDocument(rootUri, relativeRoot)
      } ?: error("Unable to open authorized directory: $relativeRoot")
      if (!root.isDirectory) error("Path is not a directory: $relativeRoot")
      val entries = JSONArray()
      walk(root, "", query.trim().lowercase(), maxResults.coerceIn(1, 200), entries)
      JSONObject().put("entries", entries)
    }
  }

  @JavascriptInterface
  fun readTextFile(uri: String, maxBytes: Int): String {
    return wrapJson {
      readText(Uri.parse(uri), maxBytes.coerceIn(512, 512000))
    }
  }

  @JavascriptInterface
  fun readTextFileInTree(rootUri: String, relativePath: String, maxBytes: Int): String {
    return wrapJson {
      val doc = resolveDocument(rootUri, relativePath)
        ?: error("File not found: $relativePath")
      if (doc.isDirectory) error("Path is a directory: $relativePath")
      readText(doc.uri, maxBytes.coerceIn(512, 512000))
    }
  }

  @JavascriptInterface
  fun writeTextFile(uri: String, content: String): String {
    return wrapJson {
      writeText(Uri.parse(uri), content)
      JSONObject()
        .put("path", uri)
        .put("action", "write")
        .put("size", content.length)
    }
  }

  @JavascriptInterface
  fun writeTextFileInTree(rootUri: String, relativePath: String, content: String): String {
    return wrapJson {
      val doc = ensureFile(rootUri, relativePath)
      writeText(doc.uri, content)
      JSONObject()
        .put("path", doc.uri.toString())
        .put("action", "write")
        .put("size", content.length)
    }
  }

  @JavascriptInterface
  fun deleteDocument(uri: String): String {
    return wrapJson {
      val doc = DocumentFile.fromSingleUri(activity, Uri.parse(uri))
        ?: error("File not found: $uri")
      if (doc.isDirectory) error("Deleting directories is not supported")
      val size = doc.length()
      if (!doc.delete()) error("Delete failed: $uri")
      JSONObject()
        .put("path", uri)
        .put("action", "delete")
        .put("size", size)
    }
  }

  @JavascriptInterface
  fun deleteDocumentInTree(rootUri: String, relativePath: String): String {
    return wrapJson {
      val doc = resolveDocument(rootUri, relativePath)
        ?: error("File not found: $relativePath")
      if (doc.isDirectory) error("Deleting directories is not supported")
      val size = doc.length()
      if (!doc.delete()) error("Delete failed: $relativePath")
      JSONObject()
        .put("path", doc.uri.toString())
        .put("action", "delete")
        .put("size", size)
    }
  }

  private fun walk(file: DocumentFile, prefix: String, needle: String, maxResults: Int, entries: JSONArray) {
    for (child in file.listFiles()) {
      if (entries.length() >= maxResults) return
      val name = child.name ?: continue
      val displayPath = if (prefix.isBlank()) name else "$prefix/$name"
      if (needle.isBlank() ||
        name.lowercase().contains(needle) ||
        displayPath.lowercase().contains(needle)
      ) {
        entries.put(
          JSONObject()
            .put("path", child.uri.toString())
            .put("name", name)
            .put("displayPath", displayPath)
            .put("kind", if (child.isDirectory) "directory" else "file")
            .put("size", child.length())
        )
      }
      if (child.isDirectory) {
        walk(child, displayPath, needle, maxResults, entries)
      }
    }
  }

  private fun readText(uri: Uri, maxBytes: Int): JSONObject {
    val stream = activity.contentResolver.openInputStream(uri)
      ?: error("Unable to open file: $uri")
    val buffer = ByteArray(8192)
    val out = ByteArrayOutputStream()
    var truncated = false
    stream.use { input ->
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        if (out.size() + read > maxBytes) {
          out.write(buffer, 0, maxBytes - out.size())
          truncated = true
          break
        }
        out.write(buffer, 0, read)
      }
    }
    val bytes = out.toByteArray()
    return JSONObject()
      .put("path", uri.toString())
      .put("content", bytes.toString(Charsets.UTF_8))
      .put("size", bytes.size)
      .put("truncated", truncated)
  }

  private fun writeText(uri: Uri, content: String) {
    val stream = activity.contentResolver.openOutputStream(uri, "wt")
      ?: error("Unable to open file for writing: $uri")
    stream.use {
      it.write(content.toByteArray(Charsets.UTF_8))
      it.flush()
    }
  }

  private fun resolveDocument(rootUri: String, relativePath: String): DocumentFile? {
    var current = DocumentFile.fromTreeUri(activity, Uri.parse(rootUri)) ?: return null
    val parts = relativePath.trim().trim('/').split('/').filter { it.isNotBlank() }
    for (part in parts) {
      current = current.findFile(part) ?: return null
    }
    return current
  }

  private fun ensureFile(rootUri: String, relativePath: String): DocumentFile {
    var current = DocumentFile.fromTreeUri(activity, Uri.parse(rootUri))
      ?: error("Unable to open authorized directory")
    val parts = relativePath.trim().trim('/').split('/').filter { it.isNotBlank() }
    if (parts.isEmpty()) error("Missing file name")
    for (part in parts.dropLast(1)) {
      current = current.findFile(part) ?: current.createDirectory(part)
        ?: error("Unable to create directory: $part")
      if (!current.isDirectory) error("Path segment is not a directory: $part")
    }
    val fileName = parts.last()
    val existing = current.findFile(fileName)
    if (existing != null) {
      if (existing.isDirectory) error("Target is a directory: $fileName")
      return existing
    }
    return current.createFile("text/plain", fileName)
      ?: error("Unable to create file: $fileName")
  }

  private fun wrapJson(block: () -> JSONObject): String {
    return try {
      block().put("ok", true).toString()
    } catch (error: Throwable) {
      JSONObject()
        .put("ok", false)
        .put("error", error.message ?: error.toString())
        .toString()
    }
  }
}
`;

const ANDROID_LIGHT_THEME = `<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.workplan.Starting" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">#f8fafc</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item>
        <item name="windowSplashScreenIconBackgroundColor">#2563eb</item>
        <item name="windowSplashScreenAnimationDuration">320</item>
        <item name="android:windowLightStatusBar">true</item>
        <item name="android:navigationBarColor">#f8fafc</item>
        <item name="postSplashScreenTheme">@style/Theme.workplan</item>
    </style>

    <style name="Theme.workplan" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="android:windowLightStatusBar">true</item>
        <item name="android:navigationBarColor">#f8fafc</item>
        <item name="android:fontFamily">sans</item>
    </style>
</resources>
`;

const ANDROID_NIGHT_THEME = `<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.workplan.Starting" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">#0f172a</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item>
        <item name="windowSplashScreenIconBackgroundColor">#1d4ed8</item>
        <item name="windowSplashScreenAnimationDuration">320</item>
        <item name="android:navigationBarColor">#0f172a</item>
        <item name="postSplashScreenTheme">@style/Theme.workplan</item>
    </style>

    <style name="Theme.workplan" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="android:navigationBarColor">#0f172a</item>
        <item name="android:fontFamily">sans</item>
    </style>
</resources>
`;

function writeIfChanged(file, next) {
    const prev = readFileSync(file, 'utf8');
    if (prev === next) return false;
    writeFileSync(file, next);
    return true;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureGradleDependency(gradle, notation) {
    if (gradle.includes(`"${notation}"`)) return gradle;
    return gradle.replace(
        /(dependencies\s*\{\r?\n)/,
        `$1    implementation("${notation}")\n`
    );
}

function patchAndroidGradle(file) {
    if (!existsSync(file)) return false;

    let gradle = readFileSync(file, 'utf8');
    gradle = gradle.replace(
        /manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"false"/g,
        'manifestPlaceholders["usesCleartextTraffic"] = "true"'
    );

    if (!/defaultConfig\s*\{[\s\S]*?manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"true"/.test(gradle)) {
        gradle = gradle.replace(
            /(defaultConfig\s*\{\r?\n)/,
            '$1        manifestPlaceholders["usesCleartextTraffic"] = "true"\n'
        );
    }

    gradle = ensureGradleDependency(gradle, 'androidx.core:core-ktx:1.16.0');
    gradle = ensureGradleDependency(gradle, 'androidx.core:core-splashscreen:1.0.1');
    gradle = ensureGradleDependency(gradle, 'androidx.documentfile:documentfile:1.0.1');

    return writeIfChanged(file, gradle);
}

function patchAndroidGradleProperties(file) {
    if (!existsSync(file)) return false;

    const props = readFileSync(file, 'utf8');
    if (/^android\.overridePathCheck=true$/m.test(props)) return false;

    const suffix = props.endsWith('\n') ? '' : '\n';
    writeFileSync(file, `${props}${suffix}android.overridePathCheck=true\n`);
    return true;
}

function patchAndroidManifest(file) {
    if (!existsSync(file)) return false;

    const original = readFileSync(file, 'utf8');
    let manifest = original;
    const missing = [];

    for (const line of ANDROID_PERMISSIONS) {
        const name = line.match(/android:name="([^"]+)"/)?.[1];
        if (!name) continue;

        const permissionPattern = new RegExp(
            `^[ \\t]*<uses-permission\\b(?=[^>]*android:name="${escapeRegExp(name)}")[^>]*/>[ \\t]*(?:\\r?\\n)?`,
            'm'
        );

        if (permissionPattern.test(manifest)) {
            manifest = manifest.replace(permissionPattern, `    ${line}\n`);
        } else {
            missing.push(line);
        }
    }

    if (missing.length > 0) {
        manifest = manifest.replace(
            /(<manifest\b[^>]*>\r?\n)/,
            `$1${missing.map(line => `    ${line}`).join('\n')}\n`
        );
    }

    if (
        manifest.includes('android:name=".MainActivity"') &&
        !manifest.includes('android:enableOnBackInvokedCallback=')
    ) {
        manifest = manifest.replace(
            /(android:exported="true")(\s*>)/,
            '$1\n            android:enableOnBackInvokedCallback="true"$2'
        );
    }

    if (manifest === original) return false;
    writeFileSync(file, manifest);
    return true;
}

function patchAndroidMainActivity(file) {
    if (!existsSync(file)) return false;
    return writeIfChanged(file, ANDROID_MAIN_ACTIVITY);
}

function patchAndroidThemes(androidDir) {
    const changed = [];
    const lightTheme = join(androidDir, 'app', 'src', 'main', 'res', 'values', 'themes.xml');
    const nightTheme = join(androidDir, 'app', 'src', 'main', 'res', 'values-night', 'themes.xml');

    if (existsSync(lightTheme) && writeIfChanged(lightTheme, ANDROID_LIGHT_THEME)) {
        changed.push('light theme');
    }
    if (existsSync(nightTheme) && writeIfChanged(nightTheme, ANDROID_NIGHT_THEME)) {
        changed.push('night theme');
    }

    return changed;
}

function patchGeneratedAndroidProject(mode) {
    if (mode === 'web' || process.env.VITE_BUILD_TARGET === 'web') return;

    const androidDir = join(process.cwd(), 'src-tauri', 'gen', 'android');
    if (!existsSync(androidDir)) return;

    const changed = [];
    if (patchAndroidGradle(join(androidDir, 'app', 'build.gradle.kts'))) changed.push('Gradle');
    if (patchAndroidGradleProperties(join(androidDir, 'gradle.properties'))) changed.push('Gradle properties');
    if (patchAndroidManifest(join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'))) changed.push('manifest');
    if (patchAndroidMainActivity(join(androidDir, 'app', 'src', 'main', 'java', 'com', 'makotoarai', 'workplan', 'MainActivity.kt'))) {
        changed.push('MainActivity');
    }
    changed.push(...patchAndroidThemes(androidDir));

    if (changed.length > 0) {
        console.log(`[vite android] patched generated Android project: ${changed.join(', ')}`);
    }
}

function workplanAndroidGeneratedPlugin(mode) {
    return {
        name: 'workplan-android-generated',
        apply: 'build',
        closeBundle() {
            patchGeneratedAndroidProject(mode);
        }
    };
}

function workplanVditorVendorPlugin(mode) {
    const vendorRoute = '/vendor/vditor/dist';
    const sourceDir = resolve(process.cwd(), 'node_modules', 'vditor', 'dist');

    function contentType(file) {
        if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
        if (file.endsWith('.css')) return 'text/css; charset=utf-8';
        if (file.endsWith('.svg')) return 'image/svg+xml';
        if (file.endsWith('.png')) return 'image/png';
        if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
        if (file.endsWith('.gif')) return 'image/gif';
        if (file.endsWith('.woff2')) return 'font/woff2';
        if (file.endsWith('.woff')) return 'font/woff';
        if (file.endsWith('.ttf')) return 'font/ttf';
        return 'application/octet-stream';
    }

    function isInsideSourceDir(file) {
        return file === sourceDir || file.startsWith(`${sourceDir}${sep}`);
    }

    function walkFiles(dir, files = []) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const file = join(dir, entry.name);
            if (entry.isDirectory()) {
                walkFiles(file, files);
            } else if (entry.isFile()) {
                files.push(file);
            }
        }
        return files;
    }

    function runtimeFiles() {
        const runtimeRoots = ['css', 'images', 'js']
            .map(dir => join(sourceDir, dir))
            .filter(dir => existsSync(dir));
        const files = runtimeRoots.flatMap(dir => walkFiles(dir));
        const rootCss = join(sourceDir, 'index.css');
        if (existsSync(rootCss)) {
            files.push(rootCss);
        }
        return files;
    }

    return {
        name: 'workplan-vditor-vendor',
        configureServer(server) {
            server.middlewares.use(vendorRoute, (req, res, next) => {
                const url = new URL(req.url || '/', 'http://localhost');
                const assetPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
                const file = resolve(sourceDir, assetPath);
                if (!isInsideSourceDir(file) || !existsSync(file) || !statSync(file).isFile()) {
                    next();
                    return;
                }
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Content-Type', contentType(file));
                createReadStream(file).pipe(res);
            });
        },
        generateBundle() {
            if (!existsSync(sourceDir)) {
                throw new Error('Missing Vditor dist assets. Run the package install step before building.');
            }
            for (const file of runtimeFiles()) {
                const relative = file.slice(sourceDir.length + 1).split(sep).join('/');
                this.emitFile({
                    type: 'asset',
                    fileName: `vendor/vditor/dist/${relative}`,
                    source: readFileSync(file)
                });
            }
        }
    };
}

function defaultCargoTargetDir() {
    const root = parse(process.cwd()).root;
    const candidates = [
        process.env.WORKPLAN_CARGO_TARGET_DIR,
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'workplan-cargo-target') : '',
        join(tmpdir(), 'workplan-cargo-target'),
        root ? join(root, 'workplan-cargo-target') : ''
    ];

    return candidates.find(candidate => candidate && isAscii(candidate)) || '';
}

function argValue(args, name) {
    const inline = args.find(arg => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);

    const index = args.indexOf(name);
    if (index >= 0) return args[index + 1] || '';

    return '';
}

function isAndroidBuild(args) {
    return args[0] === 'android' && args[1] === 'build';
}

function androidTargetInfo(args) {
    const target = argValue(args, '--target') || 'aarch64';
    const normalized = target.toLowerCase();
    const targets = {
        aarch64: {
            cargo: 'aarch64-linux-android',
            abi: 'arm64-v8a',
            gradle: 'Arm64'
        },
        'aarch64-linux-android': {
            cargo: 'aarch64-linux-android',
            abi: 'arm64-v8a',
            gradle: 'Arm64'
        },
        'arm64-v8a': {
            cargo: 'aarch64-linux-android',
            abi: 'arm64-v8a',
            gradle: 'Arm64'
        }
    };

    return targets[normalized] || null;
}

function androidBuildVariant(args) {
    const debugIndex = args.indexOf('--debug');
    const isDebug = debugIndex >= 0 && args[debugIndex + 1] !== 'false';
    return {
        profile: isDebug ? 'debug' : 'release',
        gradle: isDebug ? 'Debug' : 'Release'
    };
}

function runAndroidSymlinkFallback(args, env) {
    if (process.platform !== 'win32' || !isAndroidBuild(args)) return null;

    const target = androidTargetInfo(args);
    if (!target) return null;

    const variant = androidBuildVariant(args);
    const cargoTargetDir = env.CARGO_TARGET_DIR || join(process.cwd(), 'src-tauri', 'target');
    const rustLib = join(cargoTargetDir, target.cargo, variant.profile, 'libworkplan_lib.so');
    if (!existsSync(rustLib)) return null;

    const androidDir = join(process.cwd(), 'src-tauri', 'gen', 'android');
    const gradlew = join(androidDir, 'gradlew.bat');
    if (!existsSync(gradlew)) return null;

    const jniLib = join(androidDir, 'app', 'src', 'main', 'jniLibs', target.abi, 'libworkplan_lib.so');
    mkdirSync(dirname(jniLib), { recursive: true });
    copyFileSync(rustLib, jniLib);

    const task = `assemble${target.gradle}${variant.gradle}`;
    const rustTask = `rustBuild${target.gradle}${variant.gradle}`;
    console.log(`[tauri] Windows symlink fallback: copied ${rustLib}`);
    console.log(`[tauri] Running Gradle fallback: ${task} -x ${rustTask}`);

    return spawnSync(gradlew, [task, '-x', rustTask, '--no-daemon'], {
        cwd: androidDir,
        env,
        shell: true,
        stdio: 'inherit'
    });
}

function writeSpawnOutput(result) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
}

function runTauri(args) {
    syncVersionFromFile();

    const env = { ...process.env };
    if (!env.CARGO_TARGET_DIR && process.platform === 'win32') {
        const targetDir = defaultCargoTargetDir();
        if (targetDir) {
            env.CARGO_TARGET_DIR = targetDir;
            console.log(`[tauri] CARGO_TARGET_DIR=${targetDir}`);
        }
    }

    const useAndroidFallback = process.platform === 'win32' && isAndroidBuild(args);
    const result = spawnSync('bunx', ['tauri', ...args], {
        env,
        shell: process.platform === 'win32',
        stdio: useAndroidFallback ? 'pipe' : 'inherit',
        encoding: useAndroidFallback ? 'utf8' : undefined,
        maxBuffer: 1024 * 1024 * 200
    });

    if (useAndroidFallback) {
        const fallback = runAndroidSymlinkFallback(args, env);
        if (fallback) {
            if ((fallback.status ?? 1) !== 0) {
                writeSpawnOutput(result);
            }
            process.exit(fallback.status ?? 1);
        }
        writeSpawnOutput(result);
    }

    process.exit(result.status ?? 1);
}

function runDirectCommand() {
    const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
    const currentPath = fileURLToPath(import.meta.url);
    if (invokedPath !== currentPath) return;

    const [command, ...args] = process.argv.slice(2);

    if (command === 'version:sync') {
        syncVersionFromFile();
        return;
    }

    if (command === 'tauri') {
        runTauri(args);
        return;
    }

    console.error('Usage: bun vite.config.js <version:sync|tauri> [...args]');
    process.exit(1);
}

runDirectCommand();

export default defineConfig(({ command, mode }) => {
    if (command === 'build') {
        syncVersionFromFile({ silent: true });
    }
    const appVersion = readVersionFile();

    return {
        plugins: [
            tailwindcss(),
            sveltekit(),
            workplanVditorVendorPlugin(mode),
            workplanAndroidGeneratedPlugin(mode)
        ],
        clearScreen: false,
        define: {
            __WORKPLAN_VERSION__: JSON.stringify(appVersion)
        },
        build: {
            // WorkPlan runs inside modern Tauri WebView runtimes, so targeting
            // `esnext` avoids unnecessary transpilation pressure during builds.
            target: 'esnext',
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (!id.includes('node_modules')) {
                            return undefined;
                        }

                        if (
                            id.includes('@milkdown/') ||
                            id.includes('vditor') ||
                            id.includes('marked') ||
                            id.includes('mermaid') ||
                            id.includes('katex') ||
                            id.includes('highlight.js')
                        ) {
                            return 'editor-stack';
                        }

                        if (
                            id.includes('exceljs') ||
                            id.includes('jspdf') ||
                            id.includes('html2canvas')
                        ) {
                            return 'export-stack';
                        }

                        if (
                            id.includes('chart.js') ||
                            id.includes('recharts')
                        ) {
                            return 'chart-stack';
                        }

                        if (
                            id.includes('@supabase/') ||
                            id.includes('crypto-js')
                        ) {
                            return 'data-stack';
                        }

                        return undefined;
                    }
                }
            }
        },
        server: {
            port: 1420,
            strictPort: true,
            host: true,
            fs: {
                // G4F is loaded from the repo root `g4f.dev/dist`, so dev server
                // must allow reads outside the default SvelteKit source directories.
                allow: [resolve('.')]
            }
        },
        envPrefix: ['VITE_', 'TAURI_']
    };
});
