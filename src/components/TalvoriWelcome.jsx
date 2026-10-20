import { Button } from '../ui.jsx';

export function TalvoriWelcome({ onCreate }) {
  return <section className="talvori-welcome" aria-labelledby="talvori-welcome-title">
    <img src="/empty-art/talvori-welcome.webp" width="640" height="585" alt="" draggable="false" />
    <h1 id="talvori-welcome-title">Make Talvori yours</h1>
    <p>A personal agent for your workspace. Choose its identity, give it direction, and select the AI connection it uses.</p>
    <Button variant="primary" onClick={onCreate}>Create my agent</Button>
    <small>No account is connected and no AI work starts until you choose.</small>
  </section>;
}
