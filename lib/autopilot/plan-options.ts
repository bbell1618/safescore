export const PLAN_VEHICLE_TYPES = ["Dry van", "Reefer", "Flatbed", "Tanker", "Auto hauler", "Lowboy / heavy haul", "Box truck", "Dump truck", "Other"] as const;
export const PLAN_RADIUS = [
  { value: "local", label: "Local (0-150 miles)" },
  { value: "regional", label: "Regional (150-500 miles)" },
  { value: "otr", label: "Long haul (500+ miles)" },
] as const;
export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
] as const;

export const PLAN_TIERS = [
  {
    tier: "monitor",
    name: "Monitor",
    price: "$199 / month",
    points: ["We watch your DOT record every day", "Alert when something new shows up", "Monthly progress report"],
  },
  {
    tier: "remediate",
    name: "Remediate",
    price: "$599 / month",
    points: ["Everything in Monitor", "We file to fix wrong violations and not-your-fault crashes", "Weekly plan for your drivers and trucks"],
  },
  {
    tier: "total_safety",
    name: "Total Safety",
    price: "$999 / month + $29 per driver",
    points: ["Everything in Remediate", "We run your safety department: driver files, medical cards, truck inspections", "Audit ready all year"],
  },
] as const;
