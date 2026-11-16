import { describe, expect, it } from "vitest";
import { filterPeople, isCloseFriendsMissing } from "@/lib/close-friends";

const people = [
  { full_name: "Asha Rao", username: "asha" },
  { full_name: "Bob Name", username: "bobby" },
  { full_name: null, username: "carol_k" },
];

describe("filterPeople", () => {
  it("returns everyone when nothing is typed", () => {
    expect(filterPeople(people, "  ")).toHaveLength(3);
  });
  it("matches a name or a username, ignoring case and a leading @", () => {
    expect(filterPeople(people, "ASHA").map((p) => p.username)).toEqual(["asha"]);
    expect(filterPeople(people, "@bob").map((p) => p.username)).toEqual(["bobby"]);
    expect(filterPeople(people, "carol").map((p) => p.username)).toEqual(["carol_k"]);
  });
  it("returns nothing when no one matches", () => {
    expect(filterPeople(people, "zzz")).toEqual([]);
  });
});

describe("isCloseFriendsMissing", () => {
  it("recognises a database that has not had the update", () => {
    expect(isCloseFriendsMissing({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(isCloseFriendsMissing({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isCloseFriendsMissing({ message: 'column "close_friends_only" does not exist' })).toBe(
      true,
    );
  });
  it("ignores other errors", () => {
    expect(isCloseFriendsMissing({ code: "23505", message: "duplicate key" })).toBe(false);
  });
});
