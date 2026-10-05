import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DraftBoard from "./DraftBoard";
import { demoDraft, mapSideFor } from "../engine/draft";

describe("side selection", () => {
  for (const playerSide of ["blue", "red"] as const) {
    it(`keeps blue on the left and the reserved mid pick on your ${playerSide} team`, () => {
      const draft = demoDraft();
      const before = structuredClone(draft);
      const html = renderToStaticMarkup(
        <DraftBoard
          draft={draft}
          playerSide={playerSide}
          onSelect={() => {}}
          onRemove={() => {}}
        />,
      );
      const sections = [
        ...html.matchAll(/<section\b[^>]*>.*?<\/section>/g),
      ].map((match) => match[0]);
      expect(sections).toHaveLength(2);
      expect(sections[0]).toContain('class="team-panel blue"');
      expect(sections[1]).toContain('class="team-panel red"');
      const own = sections[playerSide === "blue" ? 0 : 1];
      const enemy = sections[playerSide === "blue" ? 1 : 0];
      expect(own).toContain('aria-label="Your team"');
      expect(own).toContain("Your pick");
      expect(own).toContain("Ornn");
      expect(enemy).toContain('aria-label="Enemy team"');
      expect(enemy).toContain("Change Akali for enemy Mid");
      expect(enemy).not.toContain("Your pick");
      expect(mapSideFor("ally", playerSide)).toBe(playerSide);
      expect(mapSideFor("enemy", playerSide)).not.toBe(playerSide);
      expect(draft).toEqual(before);
    });
  }
});
