
function getEnv(env: string): string {
  const Env = process.env.DEEPSEEK_API_KEY
  if (!Env) throw new Error(`env not set for ${env}`);
  return Env
}

export const Env = {
  DEEPSEEK_API_KEY: getEnv("DEEPSEEK_API_KEY")
}
