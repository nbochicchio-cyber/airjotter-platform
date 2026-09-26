# airjotter.com v3, UI originale collaborativa

Questa versione ripristina la UI completa del mockup HTML originale e collega al backend collaborativo penna, gomma, testo, colore, spessore, pagine, pulizia, undo e redo. Le funzioni locali originali di PDF, firma, foto, ritaglio ed esportazione restano presenti e funzionanti; la loro sincronizzazione tra utenti sarà il passo successivo tramite object storage.

## Installazione
1. Copia il precedente `.env` nella cartella.
2. `docker compose down` dalla vecchia cartella.
3. `docker compose up --build` da questa cartella.
4. Apri una nuova sessione per il collaudo v3.
