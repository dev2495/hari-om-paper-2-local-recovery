"use client"

import "./label-sheet.css"

import type { CSSProperties, ReactNode } from "react"
import { QRCodeSVG } from "qrcode.react"

import { useAuth } from "@/context/AuthContext"
import { useVendors } from "@/hooks/use-master-data"
import { usePlants } from "@/hooks/use-system"
import { buildScanUrl } from "@/lib/app-url"
import { fitSize, labelHeading, millName, type PlantReelFacts } from "@/lib/reel-label"

/** The plant heading and the mill names the labels of this plant print (plant master, vendor master). */
export function usePlantLabelContext() {
  const { activePlant } = useAuth()
  const plants = usePlants()
  const vendors = useVendors({ include_inactive: true })
  const plant = (Array.isArray(plants.data) ? plants.data : []).find((row: any) => String(row.id) === String(activePlant) || String(row.code) === String(activePlant))
  const vendorRows = Array.isArray(vendors.data) ? vendors.data : []
  return {
    heading: labelHeading(plant),
    millOf: (facts: PlantReelFacts) => millName(facts, vendorRows),
  }
}

function Cell({ children, size, style, testId }: { children?: ReactNode; size: number; style?: CSSProperties; testId?: string }) {
  return (
    <div className="plant-reel-label__cell" style={{ fontSize: `${size}cqw`, ...style }} data-testid={testId}>
      {children}
    </div>
  )
}

/**
 * One reel or coil label exactly in the plant's layout (owner decision 6): heading · MILL NAME | Inv No. | Date ·
 * PLYBOND | VARIETY | GSM · values · ROLL NO. | roll no · the AIT serial very large · WEIGHT | kg, and the QR
 * (``qrValue`` is the lot's HARIOM|REEL|… identity; the printed link opens it on any phone camera).
 */
export function PlantReelLabel({ facts, qrValue, heading, mill }: { facts: PlantReelFacts; qrValue: string; heading: string; mill: string }) {
  const value = (text?: string) => text || ""
  const serial = value(facts.serial)
  return (
    <article className="plant-reel-label" data-testid="plant-reel-label" aria-label={`${facts.form === "COIL" ? "Coil" : "Reel"} label ${serial}`}>
      <div className="plant-reel-label__grid">
        <Cell size={fitSize(heading, 5.6, 96)} style={{ gridColumn: "1 / -1" }} testId="reel-label-heading">{heading}</Cell>
        <Cell size={fitSize(mill, 4.8, 21)} testId="reel-label-mill">{mill}</Cell>
        <Cell size={fitSize(facts.invoice_no, 4.4, 30)} testId="reel-label-invoice">{value(facts.invoice_no)}</Cell>
        <Cell size={fitSize(facts.received_date, 4.8, 43)} style={{ gridColumn: "3 / -1" }} testId="reel-label-date">{value(facts.received_date)}</Cell>
        <Cell size={fitSize("PLYBOND", 4.1, 21)}>PLYBOND</Cell>
        <Cell size={4.1}>VARIETY</Cell>
        <Cell size={4.1} style={{ gridColumn: "3 / -1" }}>GSM</Cell>
        <Cell size={fitSize(facts.plybond, 7.4, 21)} testId="reel-label-plybond">{value(facts.plybond)}</Cell>
        <Cell size={fitSize(facts.variety, 7, 30)} testId="reel-label-variety">{value(facts.variety)}</Cell>
        <Cell size={fitSize(facts.gsm, 6.6, 43)} style={{ gridColumn: "3 / -1" }} testId="reel-label-gsm">{value(facts.gsm)}</Cell>
        <Cell size={fitSize("ROLL NO.", 4.1, 21)}>ROLL NO.</Cell>
        <Cell size={fitSize(facts.roll_no, 6.6, 49)} style={{ gridColumn: "2 / span 2" }} testId="reel-label-roll">{value(facts.roll_no)}</Cell>
        <div className="plant-reel-label__cell plant-reel-label__qr">
          <QRCodeSVG value={buildScanUrl(qrValue)} size={256} level="M" marginSize={0} bgColor="#ffffff" fgColor="#000000" />
        </div>
        <Cell size={fitSize(serial, 12.2, 72)} style={{ gridColumn: "1 / span 3", fontWeight: 900, letterSpacing: "-0.01em" }} testId="reel-label-serial">{serial}</Cell>
        <Cell size={fitSize("WEIGHT", 3.9, 21)}>WEIGHT</Cell>
        <Cell size={fitSize(facts.weight_kg, 10, 49)} style={{ gridColumn: "2 / span 2", fontWeight: 900 }} testId="reel-label-weight">{value(facts.weight_kg)}</Cell>
      </div>
    </article>
  )
}
