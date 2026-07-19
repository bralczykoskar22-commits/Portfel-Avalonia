(function () {
  "use strict";

  var tauri = window.__TAURI__ && window.__TAURI__.core;
  if (!tauri || typeof tauri.invoke !== "function") return;

  function invoke(command, argumentsObject) {
    return tauri.invoke(command, argumentsObject || {});
  }

  window.portfelDesktop = Object.freeze({
    data: Object.freeze({
      load: function () { return invoke("load_data"); },
      save: function (payload) { return invoke("save_data", { payload: payload }); },
      export: function (payload) { return invoke("export_data", { payload: payload }); },
      import: function () { return invoke("import_data"); },
      listBackups: function () { return invoke("list_backups"); },
      restoreBackup: function (name) { return invoke("restore_backup", { name: name }); }
    }),
    statements: Object.freeze({
      preview: function (accountId, existingFingerprints) {
        return invoke("preview_statement", {
          options: {
            accountId: accountId,
            existingFingerprints: existingFingerprints
          }
        });
      }
    }),
    app: Object.freeze({
      getInfo: function () { return invoke("app_info"); },
      openDataFolder: function () { return invoke("open_data_folder"); }
    }),
    updater: Object.freeze({
      getStatus: function () { return invoke("updater_status"); },
      check: function () { return invoke("updater_check"); },
      install: function () { return invoke("updater_install"); },
      onStatus: function () { return function () {}; }
    })
  });
}());
