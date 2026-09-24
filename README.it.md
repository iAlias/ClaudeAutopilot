<div align="center">

# 🧭 Claude Autopilot

**Il modello Claude e il livello di effort giusti per ogni messaggio, in automatico.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)](https://code.claude.com/docs/en/plugins)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](.claude-plugin/plugin.json)
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
- **Permessi in parole semplici (opzionale).** Le azioni sicure passano senza prompt. Per quelle rischiose ti arriva una domanda di una frase, e il tuo "sì" vale per quella sola azione.
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

## Modulo permessi

**Disattivato di default.** Si attiva con `/autopilot permissions on`.

| Categoria | Esempi | Cosa succede |
|---|---|---|
| Sicure | letture, ricerche, build, test, git locale, modifiche nel progetto | Approvate senza chiedere |
| Rischiose | `git push`, scartare modifiche locali non salvate, cancellazioni ricorsive o fuori dal progetto, invio di dati all'esterno, installazioni globali, credenziali, impostazioni di sistema, esecuzione di `curl … \| sh` | Bloccate. Claude ti chiede in parole semplici se procedere, e il tuo "sì" approva quella sola azione per 10 minuti |
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
| `state.json` | Modalità, modulo permessi, statusline avvolta |
| `usage.json` | Ultime percentuali di consumo per sessione |
| `history.jsonl` | Un record per ogni turno |
| `permissions.log` | Decisioni del modulo permessi |

## Privacy

Tutto gira in locale. Autopilot non invia niente, da nessuna parte: nessuna telemetria e nessuna chiamata esterna. L'unico lavoro in più dei modelli è quello degli agent a cui delega, che girano dentro la tua sessione di Claude Code.

## Limiti

- Gli hook non possono cambiare il modello della sessione principale, quindi la modalità auto delega il lavoro a degli agent. Gli agent partono senza la cronologia della conversazione e lavorano solo sul brief che ricevono.
- Se Haiku è il modello della sessione, tende a ignorare l'istruzione della riga 🧭.
- Le percentuali di consumo sono poco precise e comuni a tutte le tue sessioni.

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
