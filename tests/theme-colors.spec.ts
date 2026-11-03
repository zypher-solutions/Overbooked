import { expect, test } from "@playwright/test";

test("should keep canvas and installed app chrome light when the system prefers dark", async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");

  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
    .toBe("light");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(244, 248, 245)");

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest: { background_color?: string; theme_color?: string } = await manifestResponse.json();
  expect(manifest.background_color).toBe("#F4F8F5");
  expect(manifest.theme_color).toBe("#F4F8F5");
});

test("should render primary actions in dark brand green on light surfaces", async ({ page }) => {
  await page.goto("/login");

  const signInButton = page.getByRole("button", { name: /sign in/i });
  await expect
    .poll(() => signInButton.evaluate((button) => getComputedStyle(button).backgroundColor))
    .toBe("rgb(15, 71, 67)");

  const placeholderColors = await page.evaluate(() => {
    const input = document.querySelector("#login-email");
    if (!(input instanceof HTMLInputElement)) throw new Error("Login email field is missing");
    const reference = document.createElement("span");
    reference.className = "text-muted-foreground";
    document.body.append(reference);
    const colors = {
      placeholder: getComputedStyle(input, "::placeholder").color,
      mutedForeground: getComputedStyle(reference).color,
    };
    reference.remove();
    return colors;
  });
  expect(placeholderColors.placeholder).toBe(placeholderColors.mutedForeground);

  await expect
    .poll(() => page.locator("#login-email").evaluate((input) => getComputedStyle(input).borderTopColor))
    .toBe("rgb(15, 71, 67)");

  const probeColors = await page.evaluate(() => {
    const sidebar = document.createElement("div");
    sidebar.className = "bg-sidebar text-sidebar-foreground";
    const activeItem = document.createElement("div");
    activeItem.className = "bg-sidebar-primary text-sidebar-primary-foreground";
    const hoverItem = document.createElement("a");
    hoverItem.id = "sidebar-hover-probe";
    hoverItem.className = "bg-sidebar hover:bg-sidebar-accent hover:text-sidebar-foreground text-sidebar-foreground";
    hoverItem.textContent = "Navigation";
    hoverItem.style.display = "block";
    hoverItem.style.width = "100px";
    hoverItem.style.height = "32px";
    document.body.append(sidebar, activeItem, hoverItem);

    const colors = {
      sidebar: getComputedStyle(sidebar).backgroundColor,
      sidebarText: getComputedStyle(sidebar).color,
      active: getComputedStyle(activeItem).backgroundColor,
      activeText: getComputedStyle(activeItem).color,
    };
    sidebar.remove();
    activeItem.remove();
    return colors;
  });

  await page.locator("#sidebar-hover-probe").hover();
  const hoverColors = await page.locator("#sidebar-hover-probe").evaluate((item) => ({
    background: getComputedStyle(item).backgroundColor,
    color: getComputedStyle(item).color,
  }));
  await page.locator("#sidebar-hover-probe").evaluate((item) => item.remove());

  expect(probeColors).toEqual({
    sidebar: "rgb(248, 250, 248)",
    sidebarText: "rgb(27, 48, 39)",
    active: "rgb(15, 71, 67)",
    activeText: "rgb(255, 255, 255)",
  });
  expect(hoverColors).toEqual({ background: "rgb(228, 239, 232)", color: "rgb(27, 48, 39)" });
});
