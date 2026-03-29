/**
 * Entry point: patch expo-keep-awake so "Unable to activate keep awake" (e.g. on some
 * Android emulators or when the device is locked during load) doesn't surface as an
 * unhandled rejection. Then load the real app.
 *
 * Important: patching only `exports.activateKeepAwakeAsync` is not enough — Metro/Babel
 * leaves `useKeepAwake` calling the original function in the module scope. Swallow errors
 * on the native `ExpoKeepAwake` module so every caller is covered.
 */
(function () {
  var noop = function () {};
  var noopAsync = function () { return Promise.resolve(); };
  try {
    var core = require('expo-modules-core');
    var opt = core.requireOptionalNativeModule;
    if (typeof opt === 'function') {
      var native = opt('ExpoKeepAwake');
      if (native) {
        ['activate', 'deactivate'].forEach(function (name) {
          var fn = native[name];
          if (typeof fn !== 'function') return;
          native[name] = async function (tag) {
            try {
              await fn.call(native, tag);
            } catch (_) {}
          };
        });
      }
    }
  } catch (_) {}
  try {
    var m = require('expo-keep-awake');
    if (m.activateKeepAwakeAsync) {
      var origAsync = m.activateKeepAwakeAsync;
      m.activateKeepAwakeAsync = function (tag) {
        try {
          return origAsync.call(m, tag).catch(noop);
        } catch (e) {
          return Promise.resolve();
        }
      };
    }
    if (m.activateKeepAwake) {
      var orig = m.activateKeepAwake;
      m.activateKeepAwake = function (tag) {
        try {
          var result = orig.call(m, tag);
          if (result && typeof result.catch === 'function') result.catch(noop);
        } catch (_) {}
      };
    }
    if (m.deactivateKeepAwake) {
      var origDeactivate = m.deactivateKeepAwake;
      m.deactivateKeepAwake = function (tag) {
        try { origDeactivate.call(m, tag); } catch (_) {}
      };
    }
    if (m.deactivateKeepAwakeAsync) {
      var origDeactivateAsync = m.deactivateKeepAwakeAsync;
      m.deactivateKeepAwakeAsync = function (tag) {
        try {
          return origDeactivateAsync.call(m, tag).catch(noop);
        } catch (e) {
          return Promise.resolve();
        }
      };
    }
  } catch (e) {
    // Native module failed to load (e.g. "Unable to activate keep awake"); stub so callers don't crash
    try {
      var path = require.resolve('expo-keep-awake');
      require('module')._cache[path] = { exports: {
        activateKeepAwake: noop,
        deactivateKeepAwake: noop,
        activateKeepAwakeAsync: noopAsync,
        deactivateKeepAwakeAsync: noopAsync,
      }};
    } catch (_) {}
  }
  // Register Android widget task handler
  try {
    var registerWidgetTaskHandler = require('react-native-android-widget').registerWidgetTaskHandler;
    var widgetTaskHandler = require('./src/widget/widgetTaskHandler').widgetTaskHandler;
    registerWidgetTaskHandler(widgetTaskHandler);
  } catch (_) {}

  require('expo-router/entry');
})();
