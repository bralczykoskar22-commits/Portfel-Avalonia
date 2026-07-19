# Testowanie wersji 0.4.0-alpha.1

To jest pełna migracja ostatniej przekazanej wersji Electron do Tauri. Nie ma
danych demonstracyjnych — wszystko wpisujesz samodzielnie.

1. Zamknij wcześniejszy Portfel, a następnie zainstaluj aplikację lub uruchom
   `Aplikacja\Portfel.exe`.
2. Sprawdź znany interfejs: ciemne menu po lewej, animowane karty oraz zakładki
   Podsumowanie, Miesiące, Cele, Długi, Plan, Analizy i Ustawienia.
3. Jeśli wcześniej korzystałeś z wersji Electron, sprawdź, czy pojawiły się jej
   dane. Obie wersje korzystają z `%APPDATA%\Portfel\data\portfel.sqlite`.
4. W Ustawieniach wybierz rok, wpisz stan gotówki z 1 stycznia i zastosuj
   ustawienia. Sprawdź możliwość wyboru wszystkich 12 miesięcy.
5. W Ustawieniach włącz „Konta bankowe” i opcjonalnie „Import wyciągów”, po czym
   kliknij „Zastosuj moduły”. W menu powinna pojawić się zakładka Konta.
6. Dodaj konto osobiste. W Miesiącach dodaj wpływ lub wydatek z wybranego konta,
   a następnie transfer między kontem bankowym a gotówką.
7. Jeżeli masz testowy plik CSV, zaimportuj go z zakładki Konta. Przed dodaniem
   operacji sprawdź podgląd, rozpoznane kwoty oraz oznaczenie duplikatów.
8. Dodaj cel z kwotą i terminem. Dodaj wpłatę, a później wypłatę z celu i sprawdź,
   czy zalecana kolejna kwota przeliczyła się automatycznie.
9. Dodaj dług. Włącz odsetki tylko dla tego długu, dodaj spłatę w Miesiącach i
   sprawdź kwotę zapłaconą oraz pozostałą.
10. Sprawdź przełączniki ostrzeżeń, limitu dziennego i tygodniowego, operacji
    cyklicznych oraz kopert kategorii.
11. Kliknij „Zapisz”, zamknij program i uruchom go ponownie. Konta, operacje,
    cele, długi i ustawienia muszą pozostać.
12. W Ustawieniach sprawdź eksport/import JSON, otwieranie folderu danych oraz
    pojawianie się automatycznych kopii po kolejnych zapisach.

Jeśli pojawi się problem, zanotuj zakładkę, wykonaną czynność, oczekiwany wynik
i to, co faktycznie się stało. Dołącz zrzut ekranu — wtedy poprawka będzie
jednoznaczna.
