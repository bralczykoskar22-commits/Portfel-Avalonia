import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";

const root = new URL("../", import.meta.url);
const html = await fs.readFile(new URL("src/index.html", root), "utf8");
const bridgeScript = await fs.readFile(new URL("src/assets/tauri-bridge.js", root), "utf8");
const appScript = await fs.readFile(new URL("src/assets/app.js", root), "utf8");
const initialData = JSON.parse(await fs.readFile(new URL("src/data/budget.json", root), "utf8"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

function setValue(window, selector, value, eventName) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Brak elementu ${selector}`);
  element.value = String(value);
  if (eventName) element.dispatchEvent(new window.Event(eventName, { bubbles: true }));
  return element;
}

function submit(window, selector) {
  const form = window.document.querySelector(selector);
  assert.ok(form, `Brak formularza ${selector}`);
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

test("pełny interfejs Electron działa przez natywne polecenia Tauri", async () => {
  const window = new Window({ url: "tauri://localhost/" });
  const calls = [];
  const snapshots = [];
  let stored = clone(initialData);

  window.confirm = () => true;
  window.print = () => {};
  window.__TAURI__ = {
    core: {
      invoke: async (command, args = {}) => {
        calls.push({ command, args: clone(args) });
        if (command === "load_data") return clone(stored);
        if (command === "save_data") {
          snapshots.push(clone(stored));
          stored = clone(args.payload);
          stored.version = 4;
          stored.meta.savedAt = "2026-07-20T12:00:00.000Z";
          return {
            ok: true,
            savedAt: stored.meta.savedAt,
            path: "C:\\Users\\Test\\AppData\\Roaming\\Portfel\\data\\portfel.sqlite",
            backup: "portfel-20260720-120000-000.json"
          };
        }
        if (command === "list_backups") return { ok: true, backups: [] };
        if (command === "app_info") {
          return {
            version: "0.4.0-alpha.1",
            dataPath: "C:\\Users\\Test\\AppData\\Roaming\\Portfel\\data\\portfel.sqlite",
            dataDirectory: "C:\\Users\\Test\\AppData\\Roaming\\Portfel\\data",
            platform: "win32",
            packaged: true
          };
        }
        if (command === "updater_status" || command === "updater_check" || command === "updater_install") {
          return {
            state: "disabled",
            message: "Kanał aktualizacji zostanie aktywowany przy publikacji programu."
          };
        }
        if (command === "preview_statement") {
          return {
            ok: true,
            fileName: "konto.csv",
            delimiter: ";",
            headers: ["Data operacji", "Opis", "Kwota"],
            rows: [],
            skipped: 0,
            warnings: []
          };
        }
        if (command === "export_data") return { ok: true, path: "C:\\kopia.json" };
        if (command === "import_data") return { ok: false, canceled: true };
        if (command === "restore_backup") return { ok: true, restored: args.name };
        if (command === "open_data_folder") return "";
        throw new Error(`Nieobsługiwane polecenie ${command}`);
      }
    }
  };

  const markup = html
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script[^>]+src="assets\/(?:tauri-bridge|app)\.js"[^>]*><\/script>/g, "");
  window.document.write(markup);
  window.document.close();
  window.eval(bridgeScript);
  window.eval(appScript);

  await waitFor(
    () => window.document.querySelector("#app")?.hidden === false,
    "Aplikacja nie zakończyła ładowania"
  );

  assert.equal(window.document.querySelectorAll(".nav-button[data-view]").length, 8);
  assert.equal(window.document.querySelector("#accounts-nav").hidden, true);
  assert.match(window.document.querySelector("#spending-limits").textContent, /Bezpiecznie dzisiaj/);
  assert.match(window.document.querySelector("#spending-limits").textContent, /Limit na 7 dni/);

  window.document.querySelector('[data-view="months"]').click();
  assert.equal(window.document.querySelectorAll("#month-tabs [data-month]").length, 12);

  window.document.querySelector('[data-view="settings"]').click();
  assert.equal(window.document.querySelector("#desktop-data-file").textContent, "portfel.sqlite");
  assert.match(window.document.querySelector("#desktop-data-path").textContent, /Roaming\\Portfel\\data/);
  assert.equal(window.document.querySelector("#desktop-app-version").textContent, "0.4.0-alpha.1");

  const bankModule = window.document.querySelector("#module-bank-accounts");
  const statementModule = window.document.querySelector("#module-statement-import");
  bankModule.checked = true;
  bankModule.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(statementModule.disabled, false);
  statementModule.checked = true;
  window.document.querySelector("#save-module-settings").click();
  assert.equal(window.document.querySelector("#accounts-nav").hidden, false);

  window.document.querySelector("#accounts-nav").click();
  window.document.querySelector("#add-account").click();
  setValue(window, "#account-name", "Konto osobiste");
  setValue(window, "#account-type", "bank");
  setValue(window, "#account-opening", "2500");
  submit(window, "#account-form");
  assert.match(window.document.querySelector("#accounts-grid").textContent, /Konto osobiste/);

  window.document.querySelector('[data-view="months"]').click();
  window.document.querySelector("#add-transaction").click();
  setValue(window, "#transaction-type", "transfer", "change");
  const accountOptions = Array.from(window.document.querySelectorAll("#transaction-account option"));
  const bankOption = accountOptions.find(option => /Konto osobiste/.test(option.textContent));
  const cashOption = accountOptions.find(option => /Gotówka/.test(option.textContent));
  assert.ok(bankOption?.value, "Konto bankowe nie pojawiło się w operacji");
  assert.ok(cashOption?.value, "Gotówka nie pojawiła się w operacji");
  setValue(window, "#transaction-account", bankOption.value);
  setValue(window, "#transaction-to-account", cashOption.value);
  setValue(window, "#transaction-amount", "250");
  setValue(window, "#transaction-description", "Wypłata z bankomatu");
  submit(window, "#transaction-form");
  assert.match(window.document.querySelector("#transactions-table").textContent, /Wypłata z bankomatu/);

  window.document.querySelector('[data-view="debts"]').click();
  window.document.querySelector("#add-debt").click();
  assert.ok(window.document.querySelector("#debt-interest-enabled"));
  assert.equal(window.document.querySelector("#debt-interest-enabled").closest("label").hidden, false);
  window.document.querySelector('[data-close-dialog="debt-dialog"]').click();

  window.document.querySelector("#save-button").click();
  await waitFor(
    () => calls.some(call => call.command === "save_data"),
    "Przycisk Zapisz nie wywołał Tauri"
  );
  await waitFor(
    () => window.document.querySelector("#save-label").textContent === "Wszystko zapisane",
    "Interfejs nie potwierdził zapisu"
  );

  assert.equal(stored.version, 4);
  assert.equal(stored.settings.modules.bankAccounts, true);
  assert.equal(stored.settings.modules.statementImport, true);
  assert.equal(stored.accounts.length, 2);
  assert.equal(stored.accounts[1].name, "Konto osobiste");
  assert.equal(stored.transactions.length, 1);
  assert.equal(stored.transactions[0].type, "transfer");
  assert.equal(stored.transactions[0].accountId, bankOption.value);
  assert.equal(stored.transactions[0].toAccountId, cashOption.value);
  assert.equal(snapshots.length, 1);

  const preview = await window.portfelDesktop.statements.preview("bank-1", ["hash-1"]);
  assert.equal(preview.fileName, "konto.csv");
  const previewCall = calls.find(call => call.command === "preview_statement");
  assert.deepEqual(previewCall.args, {
    options: { accountId: "bank-1", existingFingerprints: ["hash-1"] }
  });

  assert.ok(calls.some(call => call.command === "load_data"));
  assert.ok(calls.some(call => call.command === "app_info"));
  assert.ok(calls.some(call => call.command === "updater_status"));
  assert.ok(calls.some(call => call.command === "list_backups"));

  const ids = Array.from(window.document.querySelectorAll("[id]"), element => element.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);

  await window.happyDOM.abort();
});

test("pliki wizualne są identyczne z ostatnią wersją Electron", async () => {
  const [tauriApp, tauriStyles] = await Promise.all([
    fs.readFile(new URL("src/assets/app.js", root)),
    fs.readFile(new URL("src/assets/styles.css", root))
  ]);
  const digest = value => createHash("sha256").update(value).digest("hex");
  assert.equal(digest(tauriApp), "78ada25aeae28c0370b3f98a45b598d44ab7938eca1ad4cbd8825cb41891512b");
  assert.equal(digest(tauriStyles), "20004555fa35c03cf42539d4fae3913d860e9c6f0a409a295e93a990d65f4172");
});
