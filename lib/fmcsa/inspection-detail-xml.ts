import type {
  InspectionDetailInspection,
  InspectionDetailLookup,
  InspectionDetailVehicle,
  InspectionDetailViolation,
} from "@/lib/fmcsa/inspection-detail-xml-types";

type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
};

const VOID_TAG_RE = /^<([A-Za-z_][\w:.-]*)([^>]*)\/>$/;
const OPEN_TAG_RE = /^<([A-Za-z_][\w:.-]*)([^>]*)>$/;
const CLOSE_TAG_RE = /^<\/([A-Za-z_][\w:.-]*)>$/;

export function normalizeViolationLookupCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function calculateInspectionTimeWeight(isoDate: string): number {
  const m = isoDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return 1;
  const inspYear = Number(m[1]);
  const inspMonth = Number(m[2]);
  const now = new Date();
  const monthsAgo =
    (now.getFullYear() - inspYear) * 12 + (now.getMonth() + 1 - inspMonth);
  if (monthsAgo <= 6) return 3;
  if (monthsAgo <= 12) return 2;
  return 1;
}

export function parseInspectionDetailXml(
  xml: string,
  lookups: Record<string, InspectionDetailLookup> = {}
): InspectionDetailInspection[] {
  const root = parseXml(xml);
  const inspectionsRoot = root.children.find((child) => child.name === "Inspections");
  if (!inspectionsRoot) return [];

  return children(inspectionsRoot, "Inspection").map((inspectionNode) => {
    const main = requiredChild(inspectionNode, "InspMain");
    const reportNumber = requiredText(main, "InspReportID");
    const inspectionDate = normDate(requiredText(main, "InspStartDate"));
    const locationText = textAt(main, ["InspLocation", "InspLocationText"]);
    const timeWeight = calculateInspectionTimeWeight(inspectionDate);

    const vehicles = children(child(inspectionNode, "Vehicles"), "Vehicle").map(
      parseVehicle
    );
    const violations = children(child(inspectionNode, "Violations"), "Violation").map(
      (violationNode) => parseViolation(violationNode, lookups, timeWeight)
    );

    return {
      mcmisInspectionId: requiredText(main, "inspectionId"),
      reportNumber,
      state: reportNumber.includes("-") ? reportNumber.split("-")[0] : null,
      inspectionDate,
      startTime: emptyToNull(text(main, "InspStartTime")),
      endTime: emptyToNull(text(main, "InspEndTime")),
      level: emptyToNull(text(main, "InspectionLevelDesc")),
      locationText,
      facilityName: locationText,
      postAccidentIndicator: emptyToNull(text(main, "PostAccidentIndicator")),
      timeWeight,
      totalViolations: violations.length,
      oosViolations: violations.filter((violation) => violation.oosViolation).length,
      vehicles,
      violations,
      rawData: nodeToJson(inspectionNode),
    };
  });
}

function parseVehicle(vehicleNode: XmlNode): InspectionDetailVehicle {
  return {
    unitNumber: toInt(text(vehicleNode, "VehicleUnitNum")),
    unitType: emptyToNull(text(vehicleNode, "VehicleUnitTypeCode")),
    make: emptyToNull(text(vehicleNode, "VehicleMakeCode")),
    vin: emptyToNull(text(vehicleNode, "VehicleCompanyID")),
    licensePlate: emptyToNull(text(vehicleNode, "VehicleLicenseID")),
    licenseState: emptyToNull(text(vehicleNode, "VehicleLicenseStateCode")),
    iepDot: emptyToNull(text(vehicleNode, "IEPDotNumber")),
  };
}

function parseViolation(
  violationNode: XmlNode,
  lookups: Record<string, InspectionDetailLookup>,
  timeWeight: number
): InspectionDetailViolation {
  const violationCode = requiredText(violationNode, "FedVioCode");
  const lookup = lookups[normalizeViolationLookupCode(violationCode)];

  return {
    violationCode,
    violationDescription: requiredText(violationNode, "SectionDesc"),
    oosViolation: text(violationNode, "VioOOSFlag").toUpperCase() === "YES",
    citationNumber: emptyToNull(text(violationNode, "StateCitationNumber")),
    citationResult: emptyToNull(text(violationNode, "StateCitationResult")),
    convicted: null,
    basicCategory: lookup?.basicCategory ?? null,
    severityWeight: lookup?.severityWeight ?? null,
    timeWeight,
  };
}

function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "__root__", attributes: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const tokens = xml
    .replace(/<\?xml[^>]*\?>/g, "")
    .match(/<[^>]+>|[^<]+/g) ?? [];

  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    const top = stack[stack.length - 1];
    const trimmed = token.trim();
    if (!trimmed) continue;

    const close = trimmed.match(CLOSE_TAG_RE);
    if (close) {
      if (top.name !== close[1]) {
        throw new Error(`XML close tag mismatch: expected </${top.name}>, got ${trimmed}`);
      }
      stack.pop();
      continue;
    }

    const voidTag = trimmed.match(VOID_TAG_RE);
    if (voidTag) {
      top.children.push({
        name: voidTag[1],
        attributes: parseAttributes(voidTag[2]),
        children: [],
        text: "",
      });
      continue;
    }

    const open = trimmed.match(OPEN_TAG_RE);
    if (open) {
      const node: XmlNode = {
        name: open[1],
        attributes: parseAttributes(open[2]),
        children: [],
        text: "",
      };
      top.children.push(node);
      stack.push(node);
      continue;
    }

    top.text += decodeXml(token);
  }

  if (stack.length !== 1) {
    throw new Error(`XML parse ended with unclosed tag <${stack[stack.length - 1].name}>`);
  }
  return root;
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z_][\w:.-]*)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function nodeToJson(node: XmlNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Object.keys(node.attributes).length > 0) out.$ = node.attributes;
  const ownText = node.text.trim();
  if (ownText) out._ = ownText;

  for (const childNode of node.children) {
    const value = nodeToJson(childNode);
    const existing = out[childNode.name];
    if (existing === undefined) {
      out[childNode.name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[childNode.name] = [existing, value];
    }
  }

  return out;
}

function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((candidate) => candidate.name === name);
}

function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((candidate) => candidate.name === name) ?? [];
}

function requiredChild(node: XmlNode, name: string): XmlNode {
  const found = child(node, name);
  if (!found) throw new Error(`Missing required XML element <${name}>`);
  return found;
}

function text(node: XmlNode, name: string): string {
  return child(node, name)?.text.trim() ?? "";
}

function requiredText(node: XmlNode, name: string): string {
  const value = text(node, name);
  if (!value) throw new Error(`Missing required XML text <${name}>`);
  return value;
}

function textAt(node: XmlNode, path: string[]): string | null {
  let current: XmlNode | undefined = node;
  for (const segment of path) current = child(current, segment);
  return current ? emptyToNull(current.text.trim()) : null;
}

function normDate(value: string): string {
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) throw new Error(`Unsupported inspection date format: ${value}`);
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}
