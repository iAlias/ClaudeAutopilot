<div align="center">

# 🧭 Claude Autopilot

**Il modello Claude e il livello di effort giusti per ogni messaggio, in automatico.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)](https://code.claude.com/docs/en/plugins)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-0.2.0-blue)](.claude-plugin/plugin.json)
[![Dipendenze: nessuna](https://img.shields.io/badge/dipendenze-nessuna-brightgreen)](package.json)

[English](README.md) · **Italiano**

</div>

---

Claude Autopilot è un plugin per [Claude Code](https://code.claude.com). Legge ogni messaggio che invii e ti consiglia il modello migliore (**Haiku, Sonnet, Opus o Fable**) e il **livello di effort**, con una stima di quanto consumerà dei limiti del tuo abbonamento. In modalità automatica esegue il compito con quel modello, senza chiederti conferma. Un modulo permessi opzionale sostituisce i prompt di approvazione tecnici con domande in parole semplici.

```
🧭 Consigliato: Sonnet · low · ~0.5–1% 5h · small-code (/model sonnet)
```

## Indice

- [Funzionalità](#funzionalità)
- [Come funziona](#come-funziona)
- [Requisiti](#requisiti)
- [Installazione](#installazione)
- [Comandi](#comandi)
- [La riga 🧭](#la-riga-)
- [Consumo dei limiti](#consumo-dei-limiti)
- [Ripresa automatica dopo il limite](#ripresa-automatica-dopo-il-limite)
- [Modulo permessi](#modulo-permessi)
- [Configurazione](#configurazione)
- [Privacy](#privacy)
- [Limiti](#limiti)
- [Disinstallazione](#disinstallazione)
- [Sviluppo](#sviluppo)
- [Licenza](#licenza)

## Funzionalità

- **Consiglio a ogni messaggio.** Il compito viene classificato (`question`, `trivial`, `small-code`, `feature`, `multi-file`, `architecture`, `critical`). Poi vengono scelti il modello e il livello di effort, da `low` a `max`.
- **Modalità automatica.** Se un altro modello è più adatto, il compito passa a uno dei 16 agent inclusi: Haiku, più Sonnet, Opus e Fable, ciascuno con cinque livelli di effort. Il risultato torna nella sessione principale.
- **Stime che imparano.** Ogni turno viene confrontato con le percentuali reali di consumo del tuo piano Pro/Max, sia della finestra di 5 ore sia di quella settimanale. Le stime successive si calibrano su queste misure.
- **Suggerimento ultracode.** Per i lavori grandi che si possono dividere in parti indipendenti, autopilot suggerisce di usare ultracode. Decidi sempre tu se scriverlo.
- **Ripresa automatica.** In modalità auto, il lavoro interrotto dal limite di 5 ore riparte da solo appena il limite si resetta, nella finestra aperta oppure in background.
- **Permessi in parole semplici (opzionale).** Le azioni sicure passano senza prompt. Per quelle rischiose ti arriva una domanda di una frase, e un solo "sì" sblocca tutte le azioni in attesa in quel turno, per 30 minuti.
- **Statusline.** Mostra modello, contesto, limiti 5h e 7d con l'orario di reset, e la modalità di autopilot. Può anche avvolgere la tua statusline esistente.
- **Zero dipendenze.** Usa solo Node.js, ha più di 100 test e i dati restano sul tuo PC.

## Come funziona

```
 messaggio ──► hook UserPromptSubmit ──► inietta modalità + criteri + medie misurate
                                                │
                   Claude scrive la riga 🧭     │ (e in auto delega)
                                                ▼
 statusline ──► registra consumi 5h / 7d  hook Stop / SubagentStop ──► history.jsonl
                                                │
 messaggio successivo ◄── delta dai consumi reali ┘   /autopilot stats
```

| Componente | Ruolo |
|---|---|
| `hooks/prompt-submit.mjs` | Applica i comandi `/autopilot` e inietta il contesto a ogni messaggio |
| `hooks/stop.mjs`, `hooks/subagent-stop.mjs` | Registrano ogni turno: consiglio, delega, consumi di partenza |
| `hooks/pre-tool-use.mjs` | Modulo permessi (disattivato di default) |
| `hooks/stop-failure.mjs` | Programma la ripresa quando un turno si ferma per il limite |
| `scripts/resumer.mjs` | Attende il reset e riprende la sessione |
| `skills/autopilot/SKILL.md` | Criteri di scelta, formato della riga, regole di delega |
| `agents/` | 16 agent con `model` ed `effort` preimpostati |
| `statusline/statusline.mjs` | Statusline e registrazione dei consumi |

## Requisiti

- [Claude Code](https://code.claude.com) con supporto ai plugin.
- **Node.js >= 18** nel `PATH`, perché gli hook sono script Node.
- Un piano Claude **Pro o Max** per avere le stime in % dei limiti. Senza, le stime sono in token.

## Installazione

Dentro Claude Code:

```
/plugin marketplace add iAlias/ClaudeAutopilot
/plugin install autopilot@claude-autopilot
```

Poi apri una nuova sessione ed esegui:

```
/autopilot setup
```

Il setup installa la statusline di autopilot. Se ne hai già una, ti chiede se sostituirla o avvolgerla. Prima di applicare la modifica ti mostra cosa cambia e fa un backup di `settings.json`.

## Comandi

| Comando | Effetto |
|---|---|
| `/autopilot suggest` | Solo consiglio (default) |
| `/autopilot auto` | Consiglio e delega automatica al modello e all'effort scelti |
| `/autopilot off` | Disattiva autopilot |
| `/autopilot permissions on` \| `off` | Attiva o disattiva il modulo permessi |
| `/autopilot resume on` \| `off` | Attiva o disattiva la ripresa automatica dopo il limite (attiva di default, agisce solo in modalità auto) |
| `/autopilot stats` | Stima e consumo reale a confronto, per modello ed effort |
| `/autopilot setup` | Installa o reinstalla la statusline |
| `/autopilot` | Mostra lo stato attuale |

Il cambio di modalità lo scrive l'hook, mai Claude.

## La riga 🧭

Ogni risposta inizia con una riga come queste:

```
🧭 Consigliato: Opus · high · ~3–6% 5h · multi-file           (suggest)
🧭 Haiku · - · ~0.2–0.4% 5h · trivial → delegato              (auto)
🧭 Opus · high · ~4–8% 5h · feature → in sessione (serve il contesto della conversazione)
```

| Tipo di compito | Scelta tipica |
|---|---|
| `trivial`: rinominare, riformattare, cercare un file | Haiku |
| `small-code`: modifiche piccole e chiare, comandi shell | Sonnet · low/medium |
| `feature`: feature medie, test | Sonnet · high oppure Opus · medium |
| `multi-file`: lavoro su più file, debug, review | Opus · high/xhigh |
| `architecture`: architetture nuove, bug difficili | Fable · high/xhigh |
| `critical`: la correttezza conta più del costo | Opus o Fable · max |

In modalità auto il compito viene delegato quando il modello consigliato è diverso da quello della sessione, oppure quando l'effort differisce di almeno due livelli. Resta nella sessione se dipende dalla conversazione, se richiede una tua risposta o se basta una risposta breve.

## Consumo dei limiti

La statusline registra le percentuali della finestra di 5 ore e del limite settimanale, che Claude Code fornisce agli abbonati Pro e Max. A ogni turno autopilot salva la variazione di queste percentuali accanto alla propria stima, e `/autopilot stats` le mette a confronto.

- Le misure prese mentre erano attive altre sessioni di Claude Code vengono segnate ed escluse dalla calibrazione.
- Le variazioni negative, dovute al reset della finestra, vengono scartate.
- Le percentuali sono poco precise, quindi i compiti molto piccoli possono risultare `<1%`.

## Ripresa automatica dopo il limite

In modalità auto, quando un turno si interrompe perché è stato raggiunto il limite della finestra di 5 ore, autopilot riprende il lavoro da solo appena il limite si resetta. È attiva di default; si disattiva con `/autopilot resume off`.

1. L'hook `StopFailure` (`hooks/stop-failure.mjs`, matcher `rate_limit`) registra la sessione in `resume.json`, con l'orario di reset letto dalla statusline, e avvia `scripts/resumer.mjs` come processo separato in background.
2. Il processo attende il reset più due minuti, con un controllo al minuto. Nel frattempo la statusline di quella sessione mostra `⏸ HH:MM` con l'orario previsto.
3. A quell'ora:
   - **sessione ancora aperta** → una breve esecuzione con Haiku invia un messaggio locale alla sessione, che riparte davanti a te. Il messaggio conta come inviato solo se l'esecuzione termina con la riga `AUTOPILOT_RESUME_SENT`, e viene fermata dopo 5 minuti;
   - **sessione chiusa** → la conversazione viene ripresa in background con `claude --resume <id> -p`, nella sua cartella. Questa esecuzione non ha limiti di tempo: va avanti finché Claude non ha finito.
4. L'esito viene salvato in `resume.json` e `resume.log`, e `/autopilot stats` lo conteggia. Una ripresa il cui processo in background è morto prima di finire viene contata come persa (`lost`).

Il messaggio di ripresa chiede a Claude di continuare da dove si era fermato, senza ripetere quanto già fatto. È scritto nella lingua del tuo ultimo messaggio (italiano o inglese).

Garanzie:

- La ripresa viene programmata solo per un vero limite di 5 ore: la lettura della statusline deve avere meno di 15 minuti e mostrare la finestra di 5 ore almeno al 95%, il limite settimanale sotto il 100% e un orario di reset ancora da venire. Ogni altro stop viene solo annotato in `resume.log`.
- Una sola ripresa programmata per sessione. Un nuovo stop per limite sposta solo l'orario previsto.
- Al massimo due riprese automatiche di fila per sessione. Il conteggio riparte quando scrivi nella sessione.
- Se scrivi nella sessione prima del reset, la ripresa programmata viene annullata.
- Passare a `suggest` o `off`, oppure usare `/autopilot resume off`, annulla la ripresa in attesa al controllo successivo.
- Se al reset il limite settimanale è ancora esaurito, la ripresa viene saltata e registrata. Viene saltata anche se il processo si risveglia più di 6 ore dopo il reset, e fallisce se la cartella della sessione non esiste più.
- Se il messaggio a una sessione aperta non viene confermato, il lavoro riprende in background solo se nel frattempo la sessione è stata chiusa; altrimenti la ripresa viene registrata come fallita, così la sessione non riceve il lavoro due volte.
- Un messaggio arrivato da un'altra sessione non vale mai come conferma di un'azione rischiosa.

### Permessi in una ripresa in background

Nessuno può rispondere, quindi l'esecuzione in background usa la modalità permessi che aveva la sessione. L'unica eccezione è `bypassPermissions`, che diventa `default`.

- **Modulo permessi disattivato:** in un'esecuzione headless i prompt di Claude Code non possono comparire, quindi tutto ciò che richiederebbe la tua approvazione viene negato.
- **Modulo permessi attivo:** le azioni sicure passano come sempre, quelle rischiose restano bloccate finché non le confermi nella sessione. Claude si ferma e dice cosa è in attesa.

## Modulo permessi

**Disattivato di default.** Si attiva con `/autopilot permissions on`.

| Categoria | Esempi | Cosa succede |
|---|---|---|
| Sicure | letture, ricerche, build, test, git locale, modifiche nel progetto | Approvate senza chiedere |
| Rischiose | `git push`, scartare modifiche locali non salvate, cancellazioni ricorsive o fuori dal progetto, invio di dati all'esterno, installazioni globali, credenziali, impostazioni di sistema, esecuzione di `curl … \| sh` | Bloccate. Claude ti chiede in parole semplici se procedere, e il tuo "sì" approva le azioni bloccate in quel turno per 30 minuti |
| Altri comandi shell | tutto il resto | Approvati e registrati in `permissions.log` |
| Lasciate a Claude Code | connettori MCP, richieste web, approvazione dei piani, domande | Seguono i normali prompt di Claude Code |

Il modulo protegge anche se stesso. Sono sempre rischiose le scritture in `~/.claude/autopilot/`, in `settings.json` o nella cartella del plugin, e l'esecuzione di `claude -p`. Così Claude non può approvarsi le azioni da solo né disattivare le regole.

> **Nota:** è una rete di sicurezza euristica basata su regole testuali, non una barriera di sicurezza.

## Configurazione

Le regole personalizzate vanno in `~/.claude/autopilot/permissions.json`:

```json
{
  "disabledRules": ["rm-recursive"],
  "riskyShell": [
    { "id": "no-docker", "pattern": "\\bdocker\\b", "description": "using docker" }
  ],
  "safeShell": ["^make\\b"]
}
```

File di dati, tutti in `~/.claude/autopilot/`:

| File | Contenuto |
|---|---|
| `state.json` | Modalità, modulo permessi, ripresa automatica, statusline avvolta |
| `usage.json` | Ultime percentuali di consumo per sessione |
| `history.jsonl` | Un record per ogni turno |
| `permissions.log` | Decisioni del modulo permessi |
| `resume.json` | Riprese programmate e concluse, per sessione |
| `resume.log` | Una riga per ogni esito di ripresa |

## Privacy

Tutto gira in locale. Autopilot non invia niente, da nessuna parte: nessuna telemetria e nessuna chiamata esterna. L'unico lavoro in più dei modelli è quello degli agent a cui delega, che girano dentro la tua sessione di Claude Code, e quello della ripresa automatica, che avvia `claude` sul tuo PC con il tuo account.

## Limiti

- Gli hook non possono cambiare il modello della sessione principale, quindi la modalità auto delega il lavoro a degli agent. Gli agent partono senza la cronologia della conversazione e lavorano solo sul brief che ricevono.
- Se Haiku è il modello della sessione, tende a ignorare l'istruzione della riga 🧭.
- Le percentuali di consumo sono poco precise e comuni a tutte le tue sessioni.
- La ripresa automatica funziona solo con il PC acceso e il processo di attesa in esecuzione. Dopo un riavvio la ripresa programmata si perde e viene chiusa al tuo messaggio successivo.
- La ripresa automatica riguarda solo la finestra di 5 ore. Non si può provare a comando contro un limite reale, e il ramo con la finestra aperta si basa sui messaggi tra sessioni di Claude Code.

## Disinstallazione

```
/plugin uninstall autopilot@claude-autopilot
```

Poi rimetti in `~/.claude/settings.json` la voce `statusLine` che avevi prima: il vecchio valore è nel backup `settings.json.bak-autopilot-*`. Infine elimina la cartella `~/.claude/autopilot/`.

## Sviluppo

```bash
git clone https://github.com/iAlias/ClaudeAutopilot.git
cd ClaudeAutopilot
npm test                 # node --test, nessuna dipendenza
npm run agents           # rigenera agents/*.md
claude plugin validate .
```

Issue e pull request sono benvenute.

## Licenza

[MIT](LICENSE) © 2026 Restore
