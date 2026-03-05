/**
 * Entry point: patch expo-keep-awake so "Unable to activate keep awake" (e.g. on some
 * Android emulators or when the device is locked during load) doesn't surface as an
 * unhandled rejection. Then load the real app.
 */
(function () {
  try {
    var m = require('expo-keep-awake');
    if (m.activateKeepAwakeAsync) {
      var origAsync = m.activateKeepAwakeAsync;
      m.activateKeepAwakeAsync = function (tag) {
        return origAsync.call(m, tag).catch(function () {});
      };
    }
    if (m.activateKeepAwake) {
      var orig = m.activateKeepAwake;
      m.activateKeepAwake = function (tag) {
        return orig.call(m, tag).catch(function () {});
      };
    }
  } catch (_) {}
  // Register Android widget task handler
  try {
    var registerWidgetTaskHandler = require('react-native-android-widget').registerWidgetTaskHandler;
    var widgetTaskHandler = require('./src/widget/widgetTaskHandler').widgetTaskHandler;
    registerWidgetTaskHandler(widgetTaskHandler);
  } catch (_) {}

  require('expo-router/entry');
})();
