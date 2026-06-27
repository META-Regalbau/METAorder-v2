# Mahn-Dokumenttyp in Shopware anlegen

Die Fehlermeldung **"Document type dunning not found in Shopware"** bedeutet, dass der Dokumenttyp mit dem Technical Name `dunning` (oder dem in den Einstellungen konfigurierten Namen) in Ihrer Shopware-Installation noch nicht existiert.

## Lösung

Der Dokumenttyp muss **in Shopware per Plugin** angelegt werden. Die Admin-API bietet keine einfache Möglichkeit, neue Dokumenttypen zu erstellen.

### Schritte (Kurzüberblick)

1. **Dokumenttyp in der Datenbank anlegen**  
   Plugin-Migration: Eintrag in `document_type` (z. B. `technical_name`: `dunning`) und in `document_type_translation` (Name für die Sprachen).

2. **Dokument-Generator implementieren**  
   Eine Klasse, die `DocumentGeneratorInterface` implementiert und den Technical Name `dunning` in `supports()` zurückgibt. Der Generator rendert das PDF (z. B. per Twig-Template).

3. **Nummernkreis für den Dokumenttyp**  
   Migration für `number_range`, `number_range_type` und ggf. `number_range_sales_channel`, damit Mahnungen eine fortlaufende Nummer erhalten.

### Offizielle Anleitung

Ausführliche Anleitung mit Codebeispielen (Migration, Generator, Template, Nummernkreis):

**https://developer.shopware.com/docs/guides/plugins/plugins/checkout/document/add-custom-document-type.html**

Dort den Technical Name `example` durch `dunning` ersetzen und ggf. ein eigenes Twig-Template für die Mahnung verwenden (z. B. an Rechnung angelehnt). Die Konfiguration `config.custom.stage` (Mahnstufe 1/2/3) wird von METAorder beim Erzeugen des Dokuments mitgegeben und kann im Generator für den Inhalt genutzt werden.

### Einstellungen in METAorder

Unter **Einstellungen > Mandanten > Mahnsystem** den **Dokumenttyp (Technical Name)** auf den in Shopware angelegten Technical Name setzen (Standard: `dunning`). Der Typ muss vor dem Versand von Mahnungen in Shopware existieren.
