use chrono::{Datelike, Local, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};

const BACKUP_LIMIT: i64 = 20;

#[derive(Default)]
struct StorageState {
    gate: Mutex<()>,
}

struct StoragePaths {
    database: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    ok: bool,
    saved_at: String,
    path: String,
    backup: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupInfo {
    name: String,
    size: i64,
    created_at: String,
}

#[derive(Serialize)]
struct BackupListResult {
    ok: bool,
    backups: Vec<BackupInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreResult {
    ok: bool,
    restored: String,
    safety_backup: Option<String>,
    saved_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageInfo {
    database_path: String,
    engine: &'static str,
    local_only: bool,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn backup_name() -> String {
    format!(
        "portfel-{}-{}.json",
        Utc::now().format("%Y%m%d-%H%M%S"),
        Utc::now().timestamp_subsec_micros()
    )
}

fn storage_paths(app: &AppHandle) -> Result<StoragePaths, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nie udało się ustalić katalogu danych: {error}"))?;
    Ok(StoragePaths {
        database: root.join("data").join("portfel.sqlite"),
    })
}

fn open_database(paths: &StoragePaths) -> Result<Connection, String> {
    let parent = paths
        .database
        .parent()
        .ok_or_else(|| "Nieprawidłowa ścieżka bazy danych.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Nie udało się utworzyć katalogu danych: {error}"))?;

    let connection = Connection::open(&paths.database)
        .map_err(|error| format!("Nie udało się otworzyć lokalnej bazy: {error}"))?;
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                schema_version INTEGER NOT NULL,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS backups (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                size INTEGER NOT NULL
            );
            "#,
        )
        .map_err(|error| format!("Nie udało się przygotować lokalnej bazy: {error}"))?;
    Ok(connection)
}

fn empty_data() -> Value {
    let year = Local::now().year();
    let mut balances = Map::new();
    balances.insert(year.to_string(), json!({ "available": 0, "reserve": 0 }));
    json!({
        "version": 3,
        "meta": { "savedAt": null },
        "settings": {
            "currentYear": year,
            "theme": "light",
            "balances": balances,
            "categories": [
                "Wypłata", "Dodatkowy wpływ", "Mieszkanie", "Rachunki",
                "Żywność", "Transport", "Zdrowie", "Ubezpieczenia",
                "Spłata długów", "Dom", "Odzież", "Dzieci", "Zwierzęta",
                "Rozrywka", "Rozwój", "Prezenty", "Podróże", "Inne"
            ]
        },
        "goals": [],
        "debts": [],
        "recurring": [],
        "budgets": [],
        "transactions": []
    })
}

fn validate_payload(mut payload: Value) -> Result<Value, String> {
    let object = payload
        .as_object_mut()
        .ok_or_else(|| "Główny element danych musi być obiektem.".to_string())?;

    for key in ["goals", "debts", "recurring", "budgets", "transactions"] {
        let list = object
            .get(key)
            .and_then(Value::as_array)
            .ok_or_else(|| format!("Pole „{key}” musi być listą."))?;
        if list.len() > 100_000 {
            return Err(format!("Pole „{key}” zawiera zbyt wiele elementów."));
        }
    }

    if !object.get("settings").is_some_and(Value::is_object) {
        return Err("Brak prawidłowych ustawień.".to_string());
    }

    object.insert("version".to_string(), json!(3));
    let meta = object
        .entry("meta".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !meta.is_object() {
        *meta = Value::Object(Map::new());
    }
    meta.as_object_mut()
        .expect("meta zostało ustawione jako obiekt")
        .insert("savedAt".to_string(), Value::String(now_iso()));
    Ok(payload)
}

fn serialize_payload(payload: &Value) -> Result<String, String> {
    serde_json::to_string_pretty(payload)
        .map_err(|error| format!("Nie udało się przygotować danych do zapisu: {error}"))
}

fn add_backup(
    transaction: &rusqlite::Transaction<'_>,
    payload: &str,
) -> Result<String, String> {
    let name = backup_name();
    let created_at = now_iso();
    transaction
        .execute(
            "INSERT INTO backups(id, payload, created_at, size) VALUES(?1, ?2, ?3, ?4)",
            params![name, payload, created_at, payload.len() as i64],
        )
        .map_err(|error| format!("Nie udało się utworzyć kopii danych: {error}"))?;
    transaction
        .execute(
            "DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY created_at DESC, id DESC LIMIT ?1)",
            params![BACKUP_LIMIT],
        )
        .map_err(|error| format!("Nie udało się uporządkować kopii danych: {error}"))?;
    Ok(name)
}

#[tauri::command]
fn load_data(
    app: AppHandle,
    state: State<'_, StorageState>,
) -> Result<Value, String> {
    let _guard = state
        .gate
        .lock()
        .map_err(|_| "Magazyn danych jest chwilowo niedostępny.".to_string())?;
    let paths = storage_paths(&app)?;
    let connection = open_database(&paths)?;
    let stored: Option<String> = connection
        .query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| row.get(0))
        .optional()
        .map_err(|error| format!("Nie udało się odczytać lokalnych danych: {error}"))?;

    match stored {
        Some(payload) => serde_json::from_str(&payload)
            .map_err(|error| format!("Zapisane dane są uszkodzone: {error}")),
        None => Ok(empty_data()),
    }
}

#[tauri::command]
fn save_data(
    payload: Value,
    app: AppHandle,
    state: State<'_, StorageState>,
) -> Result<SaveResult, String> {
    let _guard = state
        .gate
        .lock()
        .map_err(|_| "Magazyn danych jest chwilowo niedostępny.".to_string())?;
    let paths = storage_paths(&app)?;
    let mut connection = open_database(&paths)?;
    let payload = validate_payload(payload)?;
    let serialized = serialize_payload(&payload)?;
    let saved_at = payload["meta"]["savedAt"]
        .as_str()
        .unwrap_or_default()
        .to_string();

    let transaction = connection
        .transaction()
        .map_err(|error| format!("Nie udało się rozpocząć zapisu: {error}"))?;
    let previous: Option<String> = transaction
        .query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| row.get(0))
        .optional()
        .map_err(|error| format!("Nie udało się sprawdzić poprzedniego zapisu: {error}"))?;
    let backup = match previous {
        Some(previous) if previous != serialized => Some(add_backup(&transaction, &previous)?),
        _ => None,
    };

    transaction
        .execute(
            r#"
            INSERT INTO app_state(id, schema_version, payload, updated_at)
            VALUES(1, 3, ?1, ?2)
            ON CONFLICT(id) DO UPDATE SET
                schema_version = excluded.schema_version,
                payload = excluded.payload,
                updated_at = excluded.updated_at
            "#,
            params![serialized, saved_at],
        )
        .map_err(|error| format!("Nie udało się zapisać danych: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Nie udało się zakończyć zapisu: {error}"))?;

    Ok(SaveResult {
        ok: true,
        saved_at,
        path: paths.database.to_string_lossy().into_owned(),
        backup,
    })
}

#[tauri::command]
fn list_backups(
    app: AppHandle,
    state: State<'_, StorageState>,
) -> Result<BackupListResult, String> {
    let _guard = state
        .gate
        .lock()
        .map_err(|_| "Magazyn danych jest chwilowo niedostępny.".to_string())?;
    let paths = storage_paths(&app)?;
    let connection = open_database(&paths)?;
    let mut statement = connection
        .prepare("SELECT id, size, created_at FROM backups ORDER BY created_at DESC, id DESC")
        .map_err(|error| format!("Nie udało się odczytać listy kopii: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(BackupInfo {
                name: row.get(0)?,
                size: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|error| format!("Nie udało się odczytać listy kopii: {error}"))?;
    let backups = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nie udało się odczytać kopii: {error}"))?;
    Ok(BackupListResult { ok: true, backups })
}

#[tauri::command]
fn restore_backup(
    name: String,
    app: AppHandle,
    state: State<'_, StorageState>,
) -> Result<RestoreResult, String> {
    if name.contains('/')
        || name.contains('\\')
        || !name.starts_with("portfel-")
        || !name.ends_with(".json")
    {
        return Err("Nieprawidłowa nazwa kopii danych.".to_string());
    }

    let _guard = state
        .gate
        .lock()
        .map_err(|_| "Magazyn danych jest chwilowo niedostępny.".to_string())?;
    let paths = storage_paths(&app)?;
    let mut connection = open_database(&paths)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Nie udało się rozpocząć przywracania: {error}"))?;
    let selected: String = transaction
        .query_row(
            "SELECT payload FROM backups WHERE id = ?1",
            params![name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Nie udało się odczytać wybranej kopii: {error}"))?
        .ok_or_else(|| "Nie znaleziono wybranej kopii danych.".to_string())?;
    let current: Option<String> = transaction
        .query_row("SELECT payload FROM app_state WHERE id = 1", [], |row| row.get(0))
        .optional()
        .map_err(|error| format!("Nie udało się zabezpieczyć bieżących danych: {error}"))?;
    let safety_backup = match current {
        Some(current) => Some(add_backup(&transaction, &current)?),
        None => None,
    };

    let restored_value: Value = serde_json::from_str(&selected)
        .map_err(|error| format!("Wybrana kopia jest uszkodzona: {error}"))?;
    let restored_value = validate_payload(restored_value)?;
    let restored_payload = serialize_payload(&restored_value)?;
    let saved_at = restored_value["meta"]["savedAt"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    transaction
        .execute(
            r#"
            INSERT INTO app_state(id, schema_version, payload, updated_at)
            VALUES(1, 3, ?1, ?2)
            ON CONFLICT(id) DO UPDATE SET
                schema_version = excluded.schema_version,
                payload = excluded.payload,
                updated_at = excluded.updated_at
            "#,
            params![restored_payload, saved_at],
        )
        .map_err(|error| format!("Nie udało się przywrócić danych: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Nie udało się zakończyć przywracania: {error}"))?;

    Ok(RestoreResult {
        ok: true,
        restored: name,
        safety_backup,
        saved_at,
    })
}

#[tauri::command]
fn storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    let paths = storage_paths(&app)?;
    Ok(StorageInfo {
        database_path: paths.database.to_string_lossy().into_owned(),
        engine: "SQLite",
        local_only: true,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(StorageState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            list_backups,
            restore_backup,
            storage_info
        ])
        .run(tauri::generate_context!())
        .expect("Nie udało się uruchomić programu Portfel");
}
