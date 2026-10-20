import { Button } from '../ui.jsx';

export function FrondoseWelcome({ onCreate }) {
  return <section className="frondose-welcome" aria-labelledby="frondose-welcome-title">
    <img src="/empty-art/frondose-welcome.webp" width="640" height="585" alt="" draggable="false" />
    <h1 id="frondose-welcome-title">Make Frondose yours</h1>
    <p>A personal agent for your workspace. Choose its identity, give it direction, and select the AI connection it uses.</p>
    <Button variant="primary" onClick={onCreate}>Create my agent</Button>
    <small>No account is connected and no AI work starts until you choose.</small>
  </section>;
}
