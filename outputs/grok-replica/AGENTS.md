<!-- poort:start -->
## Quality gate (poort)

- Klaar = `node .poort/poort.mjs run push` groen. Draai het vóór je "klaar" zegt; ongewijzigde checks zijn cached en kosten niets. Dependencies uit de lockfile installeert poort zelf (prepare). "Wacht op een slot" betekent dat andere agents zware checks draaien: niet afbreken.
- Rood: lees alleen de getoonde staart en het logpad, fix alles in één ronde, draai opnieuw.
- `↷ overgeslagen` is geen groen: noem het in je eindrapport.
- UI-wijziging: bekijk de app eerst via de e2e-MCP (`open_session`, `observe`) en schrijf of update een test in `tests/*.e2e.ts` van de e2e-map: één `agent.act` per doel, dan een exacte `expect`.
- e2e-replay rood na een bewuste UI-wijziging: `node .poort/poort.mjs e2e --record`, stage `.e2e/cache/`.
- Nooit `--no-verify`. Overslaan alleen met reden en alleen de check die het betreft: `POORT_SKIP=<id> git commit ...` (commit-check) of `POORT_SKIP=<id> git push` (push-check).
- Vóór een PR: commit alles, dan `node .poort/poort.mjs verify`. Het bewijs moet bij de commit horen; niet-gecommitte wijzigingen tellen niet.
<!-- poort:end -->

## E2E-bediening met precies één effect

- Gebruik `agent.act` voor navigatie en verkenning, met daarna een exacte assertion.
- Wanneer een proef precies één servereffect of een bewust geweigerde actie moet meten, bedien de bekende knop één keer via een exact, afgebakend UI-locator. Controleer daarna de canonieke status, revisie, inhoud en het aantal effecten. Een agent mag zo'n stimulus niet herhalen om een doel alsnog te bereiken.
- Behoud alle oorspronkelijke resultaat- en negatieve assertions. Verwijder geen controles en maak deadlines niet ruimer om een opname groen te krijgen. Een stale opname wordt gericht onderzocht; herhaal niet telkens de volledige suite voordat dezelfde categorie bediening in de betrokken familie is nagekeken.
- Test je een sprong naar een exact bronbericht of een exacte scrollpositie, bedien die bekende navigatiecontrol één keer met een locator en behoud de bron-ID-, focus- en geometrieassertions. Een volledige agent-observatie van honderden rijen is daarvoor geen extra inhoudelijke oracle.
- Tel grote transcriptvensters via een read-only native DOM-count en dezelfde exacte numerieke assertion. Verzamel niet de toegankelijkheidsmetadata van elke rij om uitsluitend het aantal te bepalen. Afzonderlijke accessibility- en identiteitcontroles blijven staan.
