const animations = {
  cute: '01', meow: '02', yawn: '03', ears: '04',
  wash: '05', blink: '06', sleep: '07',
};
export const sequences = [
  ['wash', 'idle'], ['yawn', 'sleep'], ['blink', 'idle'],
  ['meow', 'cute'], ['ears', 'idle'], ['ears', 'meow'], ['ears', 'cute'],
];

export function awakeStep(random = Math.random) {
  return { name: 'awake', plays: 0, src: '/assistant-gifs/new-cat-idle.png', delay: 10000 + random() * 10000 };
}

export function centerRestStep(random = Math.random) {
  return { name: 'center-rest', plays: 0, src: '/assistant-gifs/center-cat-idle.png', delay: 10000 + random() * 10000 };
}

export function createCenterIdlePlayback(durations, random = Math.random) {
  const paths = Object.keys(durations);
  const path = paths[Math.floor(random() * paths.length)];
  const plays = random() < 0.5 ? 1 : 2;
  return [{
    name: 'center-idle', plays,
    src: path.replace('.gif', `-${plays === 1 ? 'once' : 'twice'}.gif`),
    delay: durations[path] * plays + 10000 + random() * 10000,
  }];
}

export const centerSequences = [
  ['lie-sleep', 'sleep', 'wake'],
  ['lie', 'doze', 'rise'],
  ['idle', 'wave', 'idle'],
  ['idle', 'reach', 'idle'],
  ['idle', 'yarn', 'idle'],
];

export function createCenterPlayback(durations, actions, random = Math.random) {
  const sequence = centerSequences[Math.floor(random() * centerSequences.length)];
  const steps = sequence.map(name => {
    if (name === 'idle') {
      const paths = Object.keys(durations);
      // Wave/reach share the first idle's exact registration and scale.
      const path = sequence.includes('wave') || sequence.includes('reach')
        ? paths[0] : paths[Math.floor(random() * paths.length)];
      return { name: 'center-idle', plays: 1, src: path.replace('.gif', '-once.gif'), delay: durations[path] };
    }
    const loop = name === 'sleep' || name === 'doze';
    const plays = name === 'reach' ? 2 : loop
      ? Math.ceil((5000 + random() * (name === 'sleep' ? 10000 : 5000)) / actions[name]) : 1;
    return {
      name: `center-${name}`, plays,
      src: `/assistant-gifs/center-action-${name}-${loop ? 'loop' : plays === 2 ? 'twice' : 'once'}.gif`,
      delay: actions[name] * plays,
    };
  });
  return [...steps, centerRestStep(random)];
}

export function wakePlayback(playback, random = Math.random) {
  if (!['yawn', 'sleep', 'asleep'].includes(playback.steps[playback.index].name)) return playback;
  return { steps: [awakeStep(random)], index: 0, round: playback.round + 1 };
}

export function createPlayback(durations, random = Math.random) {
  const roll = random();
  // Blink/idle accounts for 60%; the other six sequences share the rest.
  const index = roll < 0.6 ? 2 : [0, 1, 3, 4, 5, 6][Math.min(5, Math.floor((roll - 0.6) / 0.4 * 6))];
  return sequences[index].flatMap((name, step, sequence) => {
    if (name === 'sleep') return [
      { name: 'sleep', plays: 1, src: '/assistant-gifs/new-cat-sleep-entry.gif', delay: 1550 },
      { name: 'asleep', plays: 0, src: '/assistant-gifs/new-cat-asleep.png', delay: 10000 + random() * 10000 },
      awakeStep(random),
    ];
    const path = `/assistant-gifs/new-cat-${animations[name]}.gif`;
    const plays = name === 'idle' ? 0 : name === 'wash' ? 1 : random() < 0.5 ? 1 : 2;
    const duration = name === 'idle' ? 0 : durations[path] * plays;
    return {
      name, plays,
      src: name === 'idle' ? '/assistant-gifs/new-cat-idle.png'
        : path.replace('.gif', `-${plays === 1 ? 'once' : 'twice'}.gif`),
      delay: duration + (step === sequence.length - 1 ? 10000 + random() * 10000 : 0),
    };
  });
}
