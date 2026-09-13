import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PaginatedResults from "./PaginatedResults";

it("updates restored pagination even when the rendered content is reused", () => {
  const children = <p>Retained list content</p>;
  const props = { totalPages: 2, pending: false, animateChanges: false, onPageChange: () => {} };
  const view = render(<PaginatedResults {...props} page={1} resultKey="first">{children}</PaginatedResults>);
  view.rerender(<PaginatedResults {...props} page={2} resultKey="second">{children}</PaginatedResults>);
  expect(screen.getByRole("button", { name: "Page 2, current page" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("button", { name: "Page 1, current page" })).not.toBeInTheDocument();
  expect(screen.getByText("Retained list content").parentElement).toHaveAttribute("data-result-page", "2");
});

it.each([7, 50, 100])("restores page %i in a long result set with correct navigation boundaries", (page) => {
  const onPageChange = vi.fn();
  const props = { totalPages: 100, pending: false, animateChanges: false, onPageChange };
  const children = <p>Restored results</p>;
  const view = render(<PaginatedResults {...props} page={1} resultKey="page-1">{children}</PaginatedResults>);
  view.rerender(<PaginatedResults {...props} page={page} resultKey={`page-${page}`}>{children}</PaginatedResults>);
  expect(screen.getByRole("button", { name: `Page ${page}, current page` })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("Restored results").parentElement).toHaveAttribute("data-result-page", String(page));
  expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(9);
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  expect(onPageChange).toHaveBeenLastCalledWith(page - 1);
  const next = screen.getByRole("button", { name: "Next page" });
  if (page === 100) {
    expect(next).toBeDisabled();
    fireEvent.click(next);
    expect(onPageChange).toHaveBeenCalledTimes(1);
  } else {
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(onPageChange).toHaveBeenLastCalledWith(page + 1);
  }
});
