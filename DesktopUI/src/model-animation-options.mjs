export const PASS_ANIMATION = "animation.customnpc.default.pass";
export const ENTITY_ANIMATIONS = [
  ["IdleAnimation", "idle（待机）", "默认 pass（无动作）"],
  ["WalkAnimation", "walk（行走）", "默认继承待机动画"],
  ["WalkaAnimation", "walka（跑步）", "默认继承行走动画"],
  ["AttackAnimation", "attack（攻击）", "默认 pass（无动作）"],
  ["DeathAnimation", "death（死亡）", "默认死亡动画"],
];

export function animationOptions(animations, current, defaultLabel) {
  const options = [
    { value: "", label: defaultLabel },
    {
      value: PASS_ANIMATION,
      label: "pass（无动作） · animation.customnpc.default.pass",
    },
    ...animations
      .filter((animation) => animation.id !== PASS_ANIMATION)
      .map((animation) => ({
        value: animation.id,
        label: animation.id,
      })),
  ];
  if (current && !options.some((option) => option.value === current))
    options.push({
      value: current,
      label: `${current}（已有配置，当前文件未包含）`,
    });
  return options;
}
