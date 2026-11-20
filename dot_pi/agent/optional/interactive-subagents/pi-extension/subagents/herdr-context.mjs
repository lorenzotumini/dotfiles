export function inHerdrCli(env = process.env) {
  return env.HERDR_ENV === '1' &&
    /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(env.HERDR_PANE_ID ?? '') &&
    !!env.HERDR_SOCKET_PATH;
}

export function inHerdrApp(env = process.env) {
  return env.HERDR_ENV !== '1' && !!env.HC_TERMINAL_ID && !!env.HC_TERMINAL_SOCKET;
}

export function selectMux(env = process.env) {
  const requested = env.PI_SUBAGENT_MUX;
  if (requested) return requested === 'hc' ? 'herdr-core' : requested;
  if (inHerdrCli(env)) return 'herdr';
  if (inHerdrApp(env)) return 'herdr-core';
  return 'tmux';
}

export function insideHerdr(env = process.env, mux = selectMux(env)) {
  return (mux === 'herdr' && inHerdrCli(env)) ||
    (mux === 'herdr-core' && inHerdrApp(env));
}
