import { expect, test } from "vitest";
import App from "./App";

test("App is a function and returns a React element", () => {
  expect(typeof App).toBe("function");
  const element = App();
  expect(element).toBeDefined();
  expect(element.type).toBe("h1");
});
