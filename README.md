# AM RibX Viewer

Professionele webapplicatie voor het uitlezen, analyseren en presenteren van RIBX/RIPX-bestanden voor rioolinspecties.

## Projectinformatie

**Bedrijf:** AM Rioolinspecties  
**Productieomgeving:** https://ribx-viewer.amrioolinspecties.nl  
**GitHub Pages:** https://ashwinmeelhuijsen.github.io/ribx-viewer/  
**Repository:** AshwinMeelhuijsen/ribx-viewer

## Doel

AM RibX Viewer verwerkt inspectiebestanden volledig in de browser. Bestanden worden lokaal ingelezen; er is geen server-side verwerking nodig.

## MVP-functionaliteit

- Uploaden van `.ribx`, `.ripx` en `.xml`
- Kaartweergave met Leaflet en OpenStreetMap
- RD-coordinaten omzetten naar WGS84 via Proj4
- Herkennen van GWSW/RIBX-strengen op basis van `ZB_A`
- Zoeken op straat, putnummer en strengcode
- Filteren op straat
- Strengen markeren als gereinigd of aandachtspunt
- Voortgang lokaal bewaren en exporteren/importeren als JSON
- GWSW/RIBX-statusvelden voor leidingen en putten invullen
- Bijgewerkt `.ribx` bestand downloaden voor gebruik in inspectiesoftware
- Responsive interface geschikt voor GitHub Pages

## Bestandsstructuur

```text
ribx-viewer/
├── index.html
├── README.md
├── css/
│   └── map-viewer.css
├── js/
│   └── map-viewer.js
├── assets/
│   ├── logo/
│   ├── icons/
│   └── images/
└── docs/
    └── specification.md
```

## Gebruik

Open `index.html` in een browser of publiceer de map via GitHub Pages. Kies daarna een RIBX/RIPX-bestand. De kaartviewer gebruikt externe kaartbibliotheken en OpenStreetMap-tegels, dus voor de kaart is internettoegang nodig.

## Installeren als app

De pagina bevat een webapp-manifest en app-iconen voor desktop, Android en iPhone/iPad. Na publicatie kun je de viewer installeren via de browser of op iOS via **Delen** -> **Zet op beginscherm**. Als een oud icoon zichtbaar blijft, verwijder dan de bestaande snelkoppeling en voeg de pagina opnieuw toe.

## Auteur

AM Rioolinspecties  
https://www.amrioolinspecties.nl
