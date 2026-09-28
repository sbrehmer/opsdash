import { Component, type ComponentChildren } from "preact";
import { DefaultState } from "./states.tsx";

/** Catches rendering errors of one plugin widget so they never affect other widgets (FR-018). */
export class Boundary extends Component<{ children: ComponentChildren; resetKey?: unknown }, { error?: string }> {
  override state: { error?: string } = {};

  override componentDidCatch(error: Error) {
    this.setState({ error: `The widget failed to render: ${error.message}` });
  }

  override componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined });
  }

  render() {
    return this.state.error ? <DefaultState state="error" error={this.state.error} /> : this.props.children;
  }
}
