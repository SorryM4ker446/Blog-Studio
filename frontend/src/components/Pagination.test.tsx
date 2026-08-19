import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Pagination from "./Pagination";

describe("Pagination", () => {
  it("does not render when there is only one page", () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={1} onPageChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("disables boundary controls and reports requested pages", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const { rerender } = render(
      <Pagination currentPage={1} totalPages={3} onPageChange={onPageChange} />,
    );
    let previousButton = screen.getByRole("button", { name: "Previous page" });
    let nextButton = screen.getByRole("button", { name: "Next page" });

    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeVisible();
    expect(previousButton).toBeDisabled();
    expect(nextButton).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Go to page 3" }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    await user.click(nextButton);
    expect(onPageChange).toHaveBeenLastCalledWith(2);

    rerender(<Pagination currentPage={3} totalPages={3} onPageChange={onPageChange} />);
    previousButton = screen.getByRole("button", { name: "Previous page" });
    nextButton = screen.getByRole("button", { name: "Next page" });
    expect(previousButton).toBeEnabled();
    expect(nextButton).toBeDisabled();
    await user.click(previousButton);
    expect(onPageChange).toHaveBeenLastCalledWith(2);
  });

  it("shows a compact window around a middle page", () => {
    render(<Pagination currentPage={5} totalPages={10} onPageChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Go to page 1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Go to page 4" })).toBeVisible();
    const currentPage = screen.getByRole("button", { name: "Page 5, current page" });
    expect(currentPage).toHaveAttribute("aria-current", "page");
    expect(currentPage).toHaveStyle({ color: "var(--accent-contrast-text)" });
    expect(screen.getByRole("button", { name: "Go to page 6" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Go to page 10" })).toBeVisible();
    expect(screen.getAllByText("...")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Go to page 2" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to page 9" })).not.toBeInTheDocument();
  });
});
