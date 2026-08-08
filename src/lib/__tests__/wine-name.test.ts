import { describe, it, expect } from "vitest";
import { displayWineName, wineNameMeta } from "@/lib/wine-name";
describe("displayWineName", () => {
  it("drops producer + region parenthetical", () => {
    expect(displayWineName({ name: "Tenuta San Leonardo 2007 San Leonardo Red (Vigneti delle Dolomiti)", producer: "Tenuta San Leonardo", region: "Vigneti delle Dolomiti" })).toBe("San Leonardo Red");
  });
  it("falls back when the name is just the region", () => {
    const p = { name: "Rutherford, Napa Valley", producer: "Frog's Leap", region: "Rutherford, Napa Valley", grape: "Merlot" };
    expect(displayWineName(p)).toBe("Merlot");
    expect(wineNameMeta(p, "Merlot")).toBe("Frog's Leap · Rutherford, Napa Valley");
  });
  it("handles Chassorney", () => {
    expect(displayWineName({ name: "Sous Roche", producer: "Domaine de Chassorney", region: "Saint-Romain, Bourgogne" })).toBe("Sous Roche");
  });
  it("keeps a non-region parenthetical", () => {
    expect(displayWineName({ name: "Marchesi di Barolo 2016 Cannubi (Barolo)", producer: "Marchesi di Barolo", region: "Barolo" })).toBe("Cannubi");
  });
});
