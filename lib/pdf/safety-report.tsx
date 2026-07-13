import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import path from "node:path";

Font.register({
  family: "Roboto",
  fonts: [
    { src: path.join(process.cwd(), "public", "fonts", "roboto-400.woff"), fontWeight: 400 },
    { src: path.join(process.cwd(), "public", "fonts", "roboto-700.woff"), fontWeight: 700 },
    { src: path.join(process.cwd(), "public", "fonts", "roboto-400-italic.woff"), fontWeight: 400, fontStyle: "italic" },
  ],
});

export interface SafetyReportProps {
  client: {
    name: string;
    dot_number: string;
    mc_number?: string | null;
  };
  carrier: {
    legalName: string;
    dotNumber: string;
    phyCity: string;
    phyState: string;
    totalDrivers: number;
    totalPowerUnits: number;
    safetyRating: string | null;
    usdotStatus: string | null;
  };
  basics: Array<{
    category: string;
    measure: number | null;
    percentile: number | null;
    alertIndicator: string | null;
  }>;
  burden: {
    perBasic: Array<{
      category: string;
      weightedPoints: number;
      violationCount: number;
    }>;
    totalPoints: number;
  };
  openCases: Array<{
    kind: "CPDP" | "DataQ";
    label: string;
    status: string;
  }>;
  violations: Array<{
    date: string;
    description: string;
    severity_weight: number | null;
    oos_violation: boolean;
    basic_category: string | null;
  }>;
  reportDate: string;
  generatedBy: string;
}

const RED = "#C67A1E";
const DARK = "#1E1C1A";
const GRAY = "#6B6B6B";
const LIGHT_GRAY = "#9B9B9B";
const BORDER_GRAY = "#F0E8DA";
const ALT_ROW = "#f9f9f9";
const GREEN = "#16a34a";

const styles = StyleSheet.create({
  pageBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 612,
    height: 792,
    backgroundColor: "#ffffff",
  },
  page: {
    backgroundColor: "#ffffff",
    fontFamily: "Roboto",
    fontSize: 9,
    color: DARK,
  },
  content: {
    minHeight: 792,
    backgroundColor: "#ffffff",
    paddingTop: 40,
    paddingBottom: 60,
    paddingLeft: 40,
    paddingRight: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: "column",
  },
  headerBrand: {
    fontSize: 18,
    fontFamily: "Roboto",
    fontWeight: 700,
    color: RED,
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 10,
    color: GRAY,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: "column",
    alignItems: "flex-end",
  },
  headerDate: {
    fontSize: 8,
    color: GRAY,
  },
  headerConfidential: {
    fontSize: 8,
    color: LIGHT_GRAY,
    marginTop: 2,
    fontFamily: "Roboto",
    fontStyle: "italic",
  },
  headerRule: {
    borderBottomWidth: 1.5,
    borderBottomColor: RED,
    marginBottom: 14,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Roboto",
    fontWeight: 700,
    color: RED,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_GRAY,
    marginBottom: 8,
  },
  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  infoCell: {
    width: "50%",
    marginBottom: 6,
    paddingRight: 10,
  },
  infoLabel: {
    fontSize: 7,
    color: LIGHT_GRAY,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  infoValue: {
    fontSize: 9,
    color: DARK,
    fontFamily: "Roboto",
    fontWeight: 700,
  },
  infoValueSatisfactory: {
    fontSize: 9,
    color: GREEN,
    fontFamily: "Roboto",
    fontWeight: 700,
  },
  infoValueAlert: {
    fontSize: 9,
    color: RED,
    fontFamily: "Roboto",
    fontWeight: 700,
  },
  infoValueGray: {
    fontSize: 9,
    color: GRAY,
  },
  table: {
    flexDirection: "column",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 3,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f4f4f4",
    borderBottomWidth: 1,
    borderBottomColor: BORDER_GRAY,
  },
  tableHeaderCell: {
    fontSize: 7,
    fontFamily: "Roboto",
    fontWeight: 700,
    color: GRAY,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    padding: 5,
  },
  tableRow: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
  },
  tableRowAlt: {
    flexDirection: "row",
    backgroundColor: ALT_ROW,
  },
  tableCell: {
    fontSize: 8,
    color: DARK,
    padding: 5,
  },
  tableCellBold: {
    fontSize: 8,
    color: DARK,
    fontFamily: "Roboto",
    fontWeight: 700,
    padding: 5,
  },
  tableCellGray: {
    fontSize: 8,
    color: LIGHT_GRAY,
    padding: 5,
  },
  tableCellRed: {
    fontSize: 8,
    color: RED,
    fontFamily: "Roboto",
    fontWeight: 700,
    padding: 5,
  },
  tableCellGreen: {
    fontSize: 8,
    color: GREEN,
    fontFamily: "Roboto",
    fontWeight: 700,
    padding: 5,
  },
  basicColCategory: { flex: 3 },
  basicColMeasure: { flex: 1.2 },
  basicColPercentile: { flex: 1.2 },
  basicColStatus: { flex: 1 },
  caseColKind: { width: 58 },
  caseColLabel: { flex: 2 },
  caseColStatus: { flex: 2 },
  violColDate: { width: 58 },
  violColDesc: { flex: 3 },
  violColBasic: { flex: 1.5 },
  violColSeverity: { width: 48 },
  violColOos: { width: 36 },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 4,
    alignItems: "flex-start",
  },
  bulletDot: {
    fontSize: 9,
    color: DARK,
    marginRight: 6,
    marginTop: 0,
    width: 8,
  },
  bulletText: {
    fontSize: 9,
    color: DARK,
    flex: 1,
    lineHeight: 1.4,
  },
  bulletTextBold: {
    fontSize: 9,
    color: DARK,
    fontFamily: "Roboto",
    fontWeight: 700,
    flex: 1,
    lineHeight: 1.4,
  },
  note: {
    fontSize: 7.5,
    color: GRAY,
    fontFamily: "Roboto",
    fontStyle: "italic",
    marginTop: 4,
  },
  emptyState: {
    fontSize: 8,
    color: LIGHT_GRAY,
    fontFamily: "Roboto",
    fontStyle: "italic",
    paddingVertical: 10,
    textAlign: "center",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: BORDER_GRAY,
    paddingTop: 5,
  },
  footerLeft: {
    fontSize: 7,
    color: LIGHT_GRAY,
  },
  footerRight: {
    fontSize: 7,
    color: LIGHT_GRAY,
  },
});

function formatNum(val: number | null): string {
  if (val === null || val === undefined) return "N/A";
  return val.toFixed(1);
}

function formatPct(val: number | null): string {
  if (val === null || val === undefined) return "Not published";
  return `${Math.round(val)}th`;
}

function safetyRatingColor(rating: string | null): "infoValue" | "infoValueSatisfactory" | "infoValueAlert" | "infoValueGray" {
  if (!rating) return "infoValueGray";
  const r = rating.toLowerCase();
  if (r === "satisfactory") return "infoValueSatisfactory";
  if (r === "conditional" || r === "unsatisfactory") return "infoValueAlert";
  return "infoValue";
}

function formatBasicCategory(cat: string | null): string {
  if (!cat) return "-";
  return BASIC_LABELS[cat as keyof typeof BASIC_LABELS] ?? cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

export function SafetyReport({
  client,
  carrier,
  basics,
  burden,
  openCases,
  violations,
  reportDate,
}: SafetyReportProps) {
  // Keep the summary deterministic at two pages. The full count remains visible.
  const displayedViolations = violations.slice(0, 15);
  const hasMoreViolations = violations.length > 15;

  const alertCount = basics.filter((b) => b.alertIndicator === "Y").length;
  const alertCategories = basics
    .filter((b) => b.alertIndicator === "Y")
    .map((b) => b.category);

  const safetyRatingStyle = safetyRatingColor(carrier.safetyRating);

  return (
    <Document
      title={`SafeScore Safety Report - ${client.name}`}
      author="Golden Era Insurance Agency"
      subject="CSA Safety Performance Report"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.pageBackground} />
        <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerBrand}>GOLDEN ERA SAFESCORE</Text>
            <Text style={styles.headerSubtitle}>Safety Performance Report</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerDate}>Report Date: {reportDate}</Text>
            <Text style={styles.headerConfidential}>Confidential</Text>
          </View>
        </View>
        <View style={styles.headerRule} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Carrier Overview</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Legal Name</Text>
              <Text style={styles.infoValue}>{carrier.legalName || client.name}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>DOT Number</Text>
              <Text style={styles.infoValue}>{carrier.dotNumber || client.dot_number}</Text>
            </View>
            {client.mc_number ? (
              <View style={styles.infoCell}>
                <Text style={styles.infoLabel}>MC Number</Text>
                <Text style={styles.infoValue}>{client.mc_number}</Text>
              </View>
            ) : null}
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Location</Text>
              <Text style={styles.infoValue}>
                {carrier.phyCity && carrier.phyState ? `${carrier.phyCity}, ${carrier.phyState}` : "-"}
              </Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Power Units</Text>
              <Text style={styles.infoValue}>{carrier.totalPowerUnits}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Drivers</Text>
              <Text style={styles.infoValue}>{carrier.totalDrivers}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Safety Rating</Text>
              <Text style={styles[safetyRatingStyle]}>{carrier.safetyRating || "Unrated"}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Operating Status</Text>
              <Text style={carrier.usdotStatus?.toLowerCase() === "active" ? styles.infoValueSatisfactory : styles.infoValueGray}>
                {carrier.usdotStatus || "-"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weighted Violation Burden</Text>
          {burden.perBasic.length === 0 ? (
            <Text style={styles.emptyState}>No scored violations in the current 24-month window.</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, styles.basicColCategory]}>BASIC</Text>
                <Text style={[styles.tableHeaderCell, styles.basicColMeasure]}>Weighted Points</Text>
                <Text style={[styles.tableHeaderCell, styles.basicColPercentile]}>Violations</Text>
              </View>
              {burden.perBasic.map((b, i) => {
                const rowStyle = i % 2 === 1 ? styles.tableRowAlt : styles.tableRow;
                return (
                  <View key={`burden-${b.category}`} style={rowStyle}>
                    <Text style={[styles.tableCell, styles.basicColCategory]}>{formatBasicCategory(b.category)}</Text>
                    <Text style={[styles.tableCell, styles.basicColMeasure]}>{b.weightedPoints}</Text>
                    <Text style={[styles.tableCell, styles.basicColPercentile]}>{b.violationCount}</Text>
                  </View>
                );
              })}
              <View style={styles.tableRowAlt}>
                <Text style={[styles.tableCellBold, styles.basicColCategory]}>Total</Text>
                <Text style={[styles.tableCellBold, styles.basicColMeasure]}>{burden.totalPoints}</Text>
                <Text style={[styles.tableCellGray, styles.basicColPercentile]} />
              </View>
            </View>
          )}
          <Text style={styles.note}>
            FMCSA does not publish percentile rankings for low-volume carriers; SafeScore tracks the weighted violation burden that drives the BASIC measures.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>BASIC Performance Scores</Text>
          {basics.length === 0 ? (
            <Text style={styles.emptyState}>No BASIC score data available.</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, styles.basicColCategory]}>Category</Text>
                <Text style={[styles.tableHeaderCell, styles.basicColMeasure]}>Measure</Text>
                <Text style={[styles.tableHeaderCell, styles.basicColPercentile]}>Percentile</Text>
                <Text style={[styles.tableHeaderCell, styles.basicColStatus]}>Status</Text>
              </View>
              {basics.map((b, i) => {
                const rowStyle = i % 2 === 1 ? styles.tableRowAlt : styles.tableRow;
                const isAlert = b.alertIndicator === "Y";
                const hasData = b.alertIndicator !== null;
                return (
                  <View key={`basic-${i}`} style={rowStyle}>
                    <Text style={[styles.tableCell, styles.basicColCategory]}>{b.category}</Text>
                    <Text style={[styles.tableCell, styles.basicColMeasure]}>{formatNum(b.measure)}</Text>
                    <Text style={[styles.tableCell, styles.basicColPercentile]}>{formatPct(b.percentile)}</Text>
                    {isAlert ? (
                      <Text style={[styles.tableCellRed, styles.basicColStatus]}>ALERT</Text>
                    ) : hasData ? (
                      <Text style={[styles.tableCellGreen, styles.basicColStatus]}>NO ALERT</Text>
                    ) : (
                      <Text style={[styles.tableCellGray, styles.basicColStatus]}>N/A</Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
          <Text style={styles.note}>Percentile not published by FMCSA for low-volume carriers.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Open Cases</Text>
          {openCases.length === 0 ? (
            <Text style={styles.emptyState}>No challenge cases open - burden addressed operationally.</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, styles.caseColKind]}>Type</Text>
                <Text style={[styles.tableHeaderCell, styles.caseColLabel]}>Case</Text>
                <Text style={[styles.tableHeaderCell, styles.caseColStatus]}>Status</Text>
              </View>
              {openCases.map((c, i) => {
                const rowStyle = i % 2 === 1 ? styles.tableRowAlt : styles.tableRow;
                return (
                  <View key={`case-${c.kind}-${c.label}`} style={rowStyle}>
                    <Text style={[styles.tableCell, styles.caseColKind]}>{c.kind}</Text>
                    <Text style={[styles.tableCell, styles.caseColLabel]}>{c.label}</Text>
                    <Text style={[styles.tableCellGray, styles.caseColStatus]}>{c.status}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerLeft}>Golden Era Insurance Agency | SafeScore | Confidential</Text>
          <Text
            style={styles.footerRight}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <View style={styles.pageBackground} />
        <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerBrand}>GOLDEN ERA SAFESCORE</Text>
            <Text style={styles.headerSubtitle}>Safety Performance Report - Continued</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerDate}>Report Date: {reportDate}</Text>
            <Text style={styles.headerConfidential}>Confidential</Text>
          </View>
        </View>
        <View style={styles.headerRule} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{`Recent Violations (${violations.length})`}</Text>
          {violations.length === 0 ? (
            <Text style={styles.emptyState}>No violations on record.</Text>
          ) : (
            <>
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, styles.violColDate]}>Date</Text>
                  <Text style={[styles.tableHeaderCell, styles.violColDesc]}>Description</Text>
                  <Text style={[styles.tableHeaderCell, styles.violColBasic]}>BASIC</Text>
                  <Text style={[styles.tableHeaderCell, styles.violColSeverity]}>Severity</Text>
                  <Text style={[styles.tableHeaderCell, styles.violColOos]}>OOS</Text>
                </View>
                {displayedViolations.map((v, i) => {
                  const rowStyle = i % 2 === 1 ? styles.tableRowAlt : styles.tableRow;
                  return (
                    <View key={`viol-${i}`} style={rowStyle}>
                      <Text style={[styles.tableCell, styles.violColDate]}>{formatDate(v.date)}</Text>
                      <Text style={[styles.tableCell, styles.violColDesc]}>{v.description}</Text>
                      <Text style={[styles.tableCellGray, styles.violColBasic]}>{formatBasicCategory(v.basic_category)}</Text>
                      <Text style={[styles.tableCell, styles.violColSeverity]}>
                        {v.severity_weight !== null ? String(v.severity_weight) : "-"}
                      </Text>
                      {v.oos_violation ? (
                        <Text style={[styles.tableCellRed, styles.violColOos]}>Yes</Text>
                      ) : (
                        <Text style={[styles.tableCellGray, styles.violColOos]}>No</Text>
                      )}
                    </View>
                  );
                })}
              </View>
              {hasMoreViolations && (
                <Text style={styles.note}>{`Showing 15 of ${violations.length} violations`}</Text>
              )}
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Findings</Text>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletDot}>-</Text>
            <Text style={styles.bulletText}>{`Total violations on record: ${violations.length}`}</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletDot}>-</Text>
            <Text style={styles.bulletText}>{`Open challenge cases: ${openCases.length}`}</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletDot}>-</Text>
            <Text style={styles.bulletText}>{`BASIC categories in alert status: ${alertCount}`}</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bulletDot}>-</Text>
            <Text style={styles.bulletText}>{`Safety rating: ${carrier.safetyRating || "Unrated"}`}</Text>
          </View>
          {alertCount > 0 && (
            <View style={styles.bulletRow}>
              <Text style={styles.bulletDot}>-</Text>
              <Text style={styles.bulletTextBold}>{`Immediate attention recommended for: ${alertCategories.join(", ")}`}</Text>
            </View>
          )}
        </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerLeft}>Golden Era Insurance Agency | SafeScore | Confidential</Text>
          <Text
            style={styles.footerRight}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
