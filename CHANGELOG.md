# Historia zmian

## 0.4.0-alpha.1

- przywrócono dokładny interfejs i kompletną logikę ostatniej wersji Electron,
- przywrócono opcjonalne konta gotówkowe, bankowe i oszczędnościowe,
- przywrócono transfery pomiędzy kontami oraz źródło każdej operacji,
- przywrócono lokalny import wyciągów CSV z podglądem i wykrywaniem duplikatów,
- przywrócono wszystkie przełączniki modułów, limity dzienne i tygodniowe,
- zachowano cele, wypłaty z celów, automatyczne plany, długi i opcjonalne odsetki,
- ujednolicono bazę z Electron w `%APPDATA%\Portfel\data\portfel.sqlite`,
- zwiększono historię do 30 plikowych kopii zapasowych,
- dodano eksport/import JSON, otwieranie folderu danych i pojedynczą instancję,
- dodano test pełnego scenariusza konta bankowego i transferu.

## 0.3.0-alpha.1

- rozpoczęto migrację aplikacji z Avalonia na Tauri 2,
- przywrócono bezpośrednio interfejs wcześniejszej wersji webowej/Electron,
- usunięto zależność od Pythona i lokalnego serwera,
- zastąpiono zapis JSON natywną bazą SQLite w katalogu danych Windows,
- dodano automatyczne kopie poprzednich zapisów i ich przywracanie,
- dodano automatyczny test mostu JavaScript–Tauri,
- przygotowano instalator NSIS oraz kontrolną kompilację Windows.
