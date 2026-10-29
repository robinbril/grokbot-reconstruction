// Explicitly opened local fixtures, never represented as model or tool output.
export function openConversationExamples(state) {
  const id = 'local-conversation-examples';
  if (!state.agents.some(agent => agent.id === id)) {
    state.agents.push({ id, name: 'Gespreksvoorbeelden', preview: 'Lokaal voorbeeld van berichtweergave', color: '#1680f3', shape: 0 });
  }
  if (!state.messages[id]?.length) state.messages[id] = [{
    id: crypto.randomUUID(), role: 'bot', localExample: true, card: 'question',
    question: { prompt: 'Waar wil je op focussen?', options: ['Databetrouwbaarheid', 'Doorlooptijd', 'Volledigheid'], status: 'open', selected: '' },
    text: String.raw`## Pipelinekwaliteit

Dit is een lokaal voorbeeld van Markdown, geen gegenereerde analyse.

| Groep | Aantal |
| --- | ---: |
| A | 4 |
| B | 6 |

~~~json
{ "total": 10 }
~~~

$$\frac{4 + 6}{10} = 1$$

[Bron: Vercel Workflow](https://vercel.com/docs/workflow)

Veiligheidsvoorbeeld (onbetrouwbare invoer):

<img src="https://example.invalid/remote.png" onerror="alert('fixture')">

<iframe src="https://example.invalid"></iframe>

<script>alert('fixture')</script>

[Geblokkeerde scriptlink](javascript:alert%281%29)

![Geen externe afbeelding](https://example.invalid/image.png)
`,
  }];
  state.selected = id;
  state.context = false;
}
