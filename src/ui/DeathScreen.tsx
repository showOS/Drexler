import { Box, Text } from "ink";
import { useTheme } from "./ThemeContext.tsx";

// Five distinct death variants
const VARIANTS = [
  {
    headline: "STAKEHOLDERS IN SHAMBLES",
    lines: [
      "The board convenes in emergency session.",
      "Markets react with characteristic cruelty.",
      "Analyst consensus revised to: AVOID.",
    ],
  },
  {
    headline: "PIPELINE: BONE DRY. BOARD: DEVASTATED.",
    lines: [
      "Emergency restructuring announced immediately.",
      "Remaining staff issued terse memo: 'hang tight.'",
      "The deal room is very, very quiet.",
    ],
  },
  {
    headline: "ANALYSTS REVISE TARGET PRICE TO ZERO",
    lines: [
      "Short sellers: vindicated, quietly smug.",
      "Drexler could not be reached for comment.",
      "His last email had a typo. The irony.",
    ],
  },
  {
    headline: "SEC OPENS INQUIRY INTO CIRCUMSTANCES",
    lines: [
      "CNBC coverage: 47 minutes, then nothing.",
      "Drexler's legacy: a half-finished term sheet.",
      "The coffee mug on his desk: still warm.",
    ],
  },
  {
    headline: "EMERGENCY CALL SCHEDULED FOR 7AM MONDAY",
    lines: [
      "Consensus: it could have been prevented.",
      "The plant on his desk is already wilting.",
      "Recruiters texted his LinkedIn at 4am.",
    ],
  },
] as const;

const REASON_MSGS: Record<string, string> = {
  hunger:    "Cause: severe caloric deficiency. The pipeline, unreplenished, consumed itself.",
  happiness: "Cause: total morale collapse. The board's confidence evaporated entirely.",
  energy:    "Cause: complete energy depletion. Drexler's systems ceased. Standups continued.",
};

// Stock chart — backslash must be escaped in TS string literals
const CHART: string[] = [
  "  100 ┤\\",
  "      │  \\",
  "      │   \\",
  "   50 ┤    \\",
  "      │     \\",
  "      │      \\________________________________",
  "    0 ┴───────────────────────────────────────",
  "       Q1   Q2   Q3   Q4   Q5   now  →",
];

const INNER_W = 44;

function banner(text: string): string {
  const pad = Math.max(0, INNER_W - text.length);
  const lp = Math.floor(pad / 2);
  const rp = pad - lp;
  return "║" + " ".repeat(lp) + text + " ".repeat(rp) + "║";
}

const TOP = "╔" + "═".repeat(INNER_W) + "╗";
const BOT = "╚" + "═".repeat(INNER_W) + "╝";

interface Props {
  reason?: string;
  variant?: number;
}

export function DeathScreen({ reason = "energy", variant = 0 }: Props) {
  const t = useTheme();
  const v = VARIANTS[variant % VARIANTS.length] ?? VARIANTS[0];
  const reasonMsg = REASON_MSGS[reason] ?? REASON_MSGS.energy;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color={t.error} bold>{TOP}</Text>
      <Text color={t.error} bold>{banner("D R E X L E R   H A S   D I E D")}</Text>
      <Text color={t.error} bold>{BOT}</Text>
      <Text> </Text>
      <Text color={t.warning} bold>  {v.headline}</Text>
      {v.lines.map((line, i) => (
        <Text key={i} color={t.dim}>  {line}</Text>
      ))}
      <Text> </Text>
      <Text color={t.primaryDim}>  {reasonMsg}</Text>
      <Text> </Text>
      <Text color={t.primaryDim}>  DRXL Share Price:</Text>
      {CHART.map((line, i) => (
        <Text key={i} color={i < 6 ? t.error : t.dim}>  {line}</Text>
      ))}
      <Text> </Text>
      <Text color={t.dim}>  Stats reset to 50% on next launch.</Text>
      <Text color={t.dim}>  Exiting in 5 seconds...</Text>
    </Box>
  );
}
