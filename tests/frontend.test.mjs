import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";

const root = new URL("../", import.meta.url);
const html = await fs.readFile(new URL("src/index.html", root), "utf8");
const appScript = await fs.readFile(new URL("src/assets/app.js", root), "utf8");
const initialData = JSON.parse(await fs.readFile(new URL("src/data/budget.json", root), "utf8"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 3000;
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

test("interfejs 1:1 korzysta z natywnego magazynu Tauri", async () => {
  const window = new Window({ url: "tauri://localhost/" });
  const calls = [];
  const backups = [];
  let stored = clone(initialData);

  window.confirm = () => true;
  window.__TAURI__ = {
    core: {
      invoke: async (command, args = {}) => {
        calls.push(command);
        if (command === "load_data") return clone(stored);
        if (command === "save_data") {
          backups.push(clone(stored));
          stored = clone(args.payload);
          stored.meta.savedAt = "2026-07-20T12:00:00Z";
          return {
            ok: true,
            savedAt: stored.meta.savedAt,
            path: "C:\\Users\\Test\\AppData\\Roaming\\pl.portfel.app\\data\\portfel.sqlite",
            backup: "portfel-test.json"
          };
        }
        if (command === "list_backups") return { ok: true, backups: [] };
        if (command === "storage_info") {
          return {
            databasePath: "C:\\Users\\Test\\AppData\\Roaming\\pl.portfel.app\\data\\portfel.sqlite",
            engine: "SQLite",
            localOnly: true
          };
        }
        throw new Error(`Nieobsługiwane polecenie ${command}`);
      }
    }
  };

  const markup = html
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script[^>]+src="assets\/app\.js"[^>]*><\/script>/, "");
  window.document.write(markup);
  window.document.close();
  window.eval(appScript);

  await waitFor(
    () => window.document.querySelector("#app")?.hidden === false,
    "Aplikacja nie zakończyła ładowania"
  );

  assert.equal(window.document.querySelectorAll(".nav-button[data-view]").length, 7);
  window.document.querySelector('[data-view="months"]').click();
  assert.equal(window.document.querySelectorAll("#month-tabs [data-month]").length, 12);
  assert.equal(window.document.querySelector("#storage-location").textContent, "Baza: portfel.sqlite");
  assert.ok(calls.includes("load_data"));
  assert.ok(calls.includes("storage_info"));

  window.document.querySelector('[data-view="goals"]').click();
  window.document.querySelector("#add-goal").click();
  setValue(window, "#goal-name", "Poduszka finansowa");
  setValue(window, "#goal-target", "10000");
  setValue(window, "#goal-start", "2026-07-20");
  setValue(window, "#goal-deadline", "2026-12-10");
  submit(window, "#goal-form");

  assert.match(window.document.querySelector("#goals-grid").textContent, /Poduszka finansowa/);

  window.document.querySelector('[data-view="months"]').click();
  window.document.querySelector("#add-transaction").click();
  setValue(window, "#transaction-date", "2026-07-20");
  setValue(window, "#transaction-type", "goal", "change");
  const target = window.document.querySelector("#transaction-target option[value]");
  assert.ok(target?.value, "Cel nie pojawił się na liście operacji");
  setValue(window, "#transaction-target", target.value);
  setValue(window, "#transaction-amount", "500");
  setValue(window, "#transaction-description", "Pierwsza wpłata");
  submit(window, "#transaction-form");

  window.document.querySelector('[data-view="goals"]').click();
  const goalText = window.document.querySelector("#goals-grid").textContent.replace(/\s+/g, " ");
  assert.match(goalText, /500,00/);
  assert.match(goalText, /9[\s ]?500,00/);

  window.document.querySelector("#save-button").click();
  await waitFor(() => calls.includes("save_data"), "Przycisk Zapisz nie wywołał Tauri");
  await waitFor(() => stored.transactions.length === 1, "Operacja nie została zapisana");
  await waitFor(
    () => window.document.querySelector("#save-label").textContent === "Wszystko zapisane",
    "Interfejs nie potwierdził zakończenia zapisu"
  );

  assert.equal(stored.goals.length, 1);
  assert.equal(stored.transactions[0].targetId, stored.goals[0].id);
  assert.equal(backups.length, 1);
  assert.equal(window.document.querySelector("#save-label").textContent, "Wszystko zapisane");

  const ids = Array.from(window.document.querySelectorAll("[id]"), element => element.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);

  await window.happyDOM.abort();
});
