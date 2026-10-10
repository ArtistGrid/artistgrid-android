# ArtistGrid per Android

App Android **non ufficiale** per [ArtistGrid](https://artistgrid.cx), la raccolta dei tracker di musica inedita.
Sfoglia gli artisti, esplora i tracker per era e ascolta i brani direttamente dal telefono, con un'interfaccia pensata per lo smartphone.

> Questo progetto non è affiliato ad ArtistGrid. Tutti i dati arrivano dalle API pubbliche del sito e i tracker appartengono ai rispettivi autori, citati nell'app.

## Funzionalità

- **Griglia degli artisti**: oltre 580 artisti con foto, ricerca istantanea e filtri (Tutti, ♥ Preferiti, ★ Consigliati, Aggiornati).
- **Tracker completi**: tutte le schede (Unreleased, Released, Recent, Best Of, Stems…), con ere, copertine, descrizioni e statistiche.
- **Dettagli dei brani**: qualità, durata disponibile, data di leak, crediti, note e link.
- **Ricerca nei brani**: cerca in tutto il tracker per titolo, note o era, con i filtri *Ascoltabili*, *Full* e *Snippet*.
- **Player integrato**: play/pausa, precedente/successivo, barra di avanzamento. Al termine di un brano parte il successivo dell'era.
- **Preferiti**: salva gli artisti che segui.
- **Uso offline**: i tracker già aperti restano consultabili senza connessione, e una copia della lista artisti è inclusa nell'app.
- **Link esterni**: gli artisti che hanno un sito tracker proprio (es. Frank Ocean) si aprono nel browser.

## Installazione

1. Scarica `ArtistGrid.apk` dalla pagina [Releases](../../releases).
2. Aprilo sul telefono e consenti l'installazione da "origini sconosciute".

Richiede Android 6.0 o superiore.

## Come funziona

È un'app [Capacitor](https://capacitorjs.com): l'interfaccia è HTML/CSS/JavaScript puro in [`www/`](www), senza framework né build step. I dati arrivano da:

| Dato | Endpoint |
| --- | --- |
| Lista artisti | `https://artists.artistgrid.cx/artists.csv` |
| Tracker | `https://trackerapi.artistgrid.cx/sh/<id>/` · `/sh/<id>/tab/<scheda>` |
| Foto artisti | `https://assets.artistgrid.cx/webp/<nome>.webp` |
| Audio | link pillows.su, pixeldrain e Google Drive risolti come sul sito |

Le richieste passano dal client HTTP nativo di Capacitor (`CapacitorHttp`), così l'app non dipende dalle regole CORS. I tracker scaricati vengono salvati in IndexedDB per l'uso offline.

## Compilare da sorgente

Requisiti: Node.js 18+, JDK 21, Android SDK (platform 35, build-tools 35).

```bash
npm install
npx cap sync android
cd android
./gradlew assembleDebug
```

L'APK viene generato in `android/app/build/outputs/apk/debug/app-debug.apk`.

> Su Windows Gradle può fallire se il progetto si trova in un percorso molto lungo: in quel caso spostalo in una cartella corta, es. `C:\dev\artistgrid-android`.

Per provare l'interfaccia nel browser durante lo sviluppo:

```bash
python -m http.server 8765 -d www
```

## Limiti noti

- Con lo schermo spento Android può mettere in pausa la riproduzione (non c'è ancora un servizio audio in background).
- Si riproducono direttamente i link pillows.su, pixeldrain e Google Drive; gli altri link si aprono esternamente.
- L'APK pubblicato è una build di debug, non firmata per il Play Store.

## Licenza

Codice rilasciato sotto licenza [MIT](LICENSE). I dati e le immagini appartengono ad ArtistGrid e ai curatori dei tracker.
