import { describe, expect, it } from "vitest";
import { pickRep } from "@/lib/cuvee";

// Non-vintage is a category, not a missing number. -1 must never decide.
describe("pickRep — NV neutrality", () => {
  it("keeps the NV bottle when the whole group is NV", () => {
    const rows = [{ id: "nv1", vintage: null }, { id: "nv2", vintage: null }];
    expect(pickRep(rows).id).toBe("nv1");
  });

  it("prefers the newest dated vintage in a mixed group", () => {
    const rows = [
      { id: "nv", vintage: null },
      { id: "d2018", vintage: 2018 },
      { id: "d2021", vintage: 2021 },
    ];
    expect(pickRep(rows).id).toBe("d2021");
  });

  it("does not let a dated bottle beat NV by sentinel comparison alone", () => {
    // An NV-only group must never fall through to a dated sibling of another
    // cuvée; and the dated comparison must run among dated rows only.
    const rows = [{ id: "nv", vintage: null }, { id: "old", vintage: 1990 }];
    expect(pickRep(rows).id).toBe("old"); // mixed -> newest dated
    expect(pickRep([rows[0]]).id).toBe("nv");
  });
});
