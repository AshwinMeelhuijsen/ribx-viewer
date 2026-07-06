# Specificatie AM RibX Viewer

## Uitgangspunten

- De applicatie draait volledig client-side.
- Publicatie via GitHub Pages vereist geen build-proces.
- RIBX/RIPX wordt als XML behandeld.
- De parser accepteert verschillende veldnamen, XML-namespaces en GWSW/RIBX-coderingen.
- Bestanden worden niet geupload naar een server.
- Kaartbibliotheken en kaarttegels worden extern geladen.

## MVP

1. Bestand kiezen of slepen naar de uploadzone.
2. XML uitlezen met `DOMParser`.
3. Strengen met RD-coordinaten herkennen en tonen op kaart.
4. Projectstatistieken tonen voor strengen, putten, lengte en straten.
5. Zoeken op straat, putnummer en strengcode.
6. Filteren op straat.
7. Strengen markeren als gereinigd of aandachtspunt.
8. Voortgang automatisch lokaal bewaren en exporteren/importeren als JSON.
9. Statusvelden voor leidingen en putten terugschrijven naar het RIBX-bestand.

## Vervolg

- Mapping uitbreiden op basis van echte RIBX/RIPX-voorbeelden.
- Putten als aparte kaartlaag tonen.
- Waarnemingen, schadecodes, foto's en videopaden koppelen aan strengen.
- Validatie uitbreiden voor alle verplichte GWSW/RIBX-velden per header.
- XLSX-export toevoegen.
- PDF-rapportages toevoegen.
- Validatie ten opzichte van NEN-EN 13508-2 coderingen.
