# Diario di Pesca

Web app (PWA) per registrare le uscite di pesca: catture, Pokedex delle specie, statistiche,
mappa degli spot e previsioni di pesca ora per ora.

- HTML, CSS e JavaScript puro, nessuna build: basta servire la cartella come sito statico.
- I dati restano **solo sul dispositivo** (IndexedDB). Esporta un backup JSON dalle Impostazioni.
- Meteo, mare e marea: Open-Meteo. Mappa: OpenStreetMap. Il GPS richiede HTTPS.

Prova in locale:

```
python -m http.server 8000
```

poi apri http://localhost:8000
