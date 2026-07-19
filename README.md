# Portfel — wersja Tauri

Natywna aplikacja finansowa dla Windows 10/11. Interfejs jest bezpośrednio
przeniesiony z wcześniejszej wersji webowej/Electron, dlatego zachowuje ten sam
układ, kolory, animacje, jasny i ciemny motyw oraz sposób obsługi.

## Co działa

- osobny widok każdego z 12 miesięcy i podsumowanie roczne,
- ręczne wpływy i wydatki bez konieczności posiadania wyciągu bankowego,
- opcjonalne konta gotówkowe, osobiste i oszczędnościowe,
- transfery pomiędzy kontami bez zaliczania ich do wydatków,
- opcjonalny, lokalny import wyciągów CSV z podglądem i wykrywaniem duplikatów,
- cele z automatycznym wyliczeniem zalecanej wpłaty i przeliczeniem po wypłacie,
- długi z postępem, terminem, ratą minimalną i oprocentowaniem,
- harmonogramy cykliczne, koperty kategorii, alerty i prognozy,
- opcjonalne limity dzienne i tygodniowe do następnej wypłaty,
- przełączniki modułów oraz odsetki włączane osobno przy konkretnym długu,
- jasny i ciemny motyw,
- przycisk „Zapisz” oraz skrót `Ctrl+S`,
- lokalna baza SQLite i 30 automatycznych kopii poprzednich zapisów,
- eksport i import danych JSON.

Program nie używa `localStorage`, nie uruchamia serwera i nie wymaga Pythona.
Dane finansowe nie są wysyłane do Internetu.

## Dane programu

Na Windows baza jest tworzona w katalogu danych użytkownika, standardowo:

```text
%APPDATA%\Portfel\data\portfel.sqlite
```

Jest to ten sam katalog i format bazy, którego używała przekazana wersja
Electron. Jeżeli baza już tam istnieje, Tauri otworzy ją bez zakładania nowego,
pustego portfela. Dane z wcześniejszej próbnej wersji Tauri są importowane tylko
wtedy, gdy właściwa baza Portfela jeszcze nie istnieje.

Odinstalowanie programu nie powinno usuwać tej bazy. Przed większą aktualizacją
warto dodatkowo skorzystać z przycisku „Eksportuj kopię”.

## Uruchomienie gotowej wersji

Najwygodniej uruchomić instalator `Portfel_*_x64-setup.exe`. Można też uruchomić
sam plik `Portfel.exe`. Windows 10 od wydania 1803 otrzymuje WebView2 wraz z
systemem; jeśli go brakuje, instalator pobierze oficjalny składnik Microsoft.

## Praca z kodem

Wymagane są:

- Node.js 20 lub nowszy,
- Rust stable,
- Windows 10/11 i narzędzia C++ z Visual Studio Build Tools.

Polecenia:

```text
npm ci
npm test
npm run dev
npm run build
```

Na Windows można również uruchomić `build-windows.bat`.

## Struktura

- `src/` — interfejs HTML/CSS/JS przeniesiony bez zmian z wersji Electron oraz
  mały most poleceń Tauri,
- `src-tauri/` — natywne okno, SQLite, kopie danych, import CSV i instalator,
- `tests/` — automatyczny test interfejsu i mostu Tauri,
- `.github/workflows/` — kontrolna kompilacja Windows.

Wygenerowane katalogi `node_modules/` i `src-tauri/target/` nie są częścią kodu
źródłowego i można je zawsze odtworzyć poleceniem `npm ci` oraz kompilacją.

## Aktualizacje

Wersję należy zmienić jednocześnie w `package.json`, `src-tauri/Cargo.toml` i
`src-tauri/tauri.conf.json`. Następnie uruchamiamy testy, kompilację Windows i
sprawdzamy zachowanie istniejącej bazy. Mechanizm automatycznych aktualizacji
zostanie włączony dopiero przed pierwszą stabilną wersją, po przygotowaniu
podpisywania paczek aktualizacyjnych.
