# Portfel — Avalonia

Lokalny menedżer finansów osobistych dla Windows 10/11. Aplikacja działa bez logowania i bez chmury. Dane są zapisywane dopiero po kliknięciu **Zapisz**.

## Co zawiera wersja 0.2.0-alpha.1

- osobne miesiące i automatyczne podsumowanie roku,
- gotówkę oraz opcjonalne konta bankowe,
- przelewy między kontami, które nie są wydatkiem,
- cele z automatycznie wyliczaną wpłatą miesięczną, tygodniową lub przy wypłacie,
- wypłaty z celu i natychmiastowe przeliczenie planu,
- długi z automatycznym saldem, ratą, terminem i opcjonalnymi odsetkami,
- wpisy cykliczne, limity kategorii oraz limit dzienny/tygodniowy,
- import wyciągów CSV z podglądem i wykrywaniem duplikatów,
- ręczny zapis w SQLite, eksport/import JSON i rotacyjne kopie bezpieczeństwa,
- jasny i ciemny motyw oraz moduły włączane w ustawieniach.

Program nie zawiera danych demonstracyjnych. Pierwsze uruchomienie tworzy wyłącznie pustą pozycję **Gotówka**.

## Dane i aktualizacje

Baza użytkownika znajduje się w `%APPDATA%\Portfel\data\portfel.sqlite`, a kopie w `%APPDATA%\Portfel\backups`. Kod programu i dane użytkownika są rozdzielone, więc wymiana `Portfel.exe` nie usuwa budżetu.

## Budowanie

Wymagany jest .NET SDK 8.0.408.

```powershell
dotnet restore Portfel.Avalonia.sln
dotnet test Portfel.Avalonia.sln -c Release
dotnet publish src/Portfel.App/Portfel.App.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

Workflow `windows-build.yml` tworzy samodzielną paczkę Windows x64 po każdym wysłaniu zmian do gałęzi `main`.
