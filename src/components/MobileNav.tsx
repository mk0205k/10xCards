import { MenuIcon } from "lucide-react";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { m } from "@/paraglide/messages.js";

interface MobileNavProps {
  user: { email: string } | null;
  pathname: string;
}

const linkBase = "transition-colors hover:text-purple-100 hover:underline";
const linkInactive = "text-purple-300";
const linkActive = "text-purple-100 underline underline-offset-4";

function navLinkClass(pathname: string, href: string) {
  return cn(linkBase, "block py-2 text-base", pathname === href ? linkActive : linkInactive);
}

export default function MobileNav({ user, pathname }: MobileNavProps) {
  return (
    <Sheet>
      <SheetTrigger
        aria-label={m.topbar_menu_open()}
        className="inline-flex items-center justify-center rounded-md p-2 text-purple-300 transition-colors hover:bg-white/10 hover:text-purple-100"
      >
        <MenuIcon className="h-5 w-5" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="right" className="bg-cosmic border-l border-white/10 text-white">
        <SheetHeader>
          <SheetTitle className="text-white">{m.topbar_menu_label()}</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-4 pb-4" aria-label={m.topbar_menu_label()}>
          {user ? (
            <>
              <span className="pb-2 text-sm text-blue-100/70">{user.email}</span>
              <a href="/dashboard" className={navLinkClass(pathname, "/dashboard")}>
                {m.topbar_dashboard()}
              </a>
              <a href="/generate" className={navLinkClass(pathname, "/generate")}>
                {m.topbar_generate()}
              </a>
              <a href="/review" className={navLinkClass(pathname, "/review")}>
                {m.topbar_review()}
              </a>
              <a href="/deck" className={navLinkClass(pathname, "/deck")}>
                {m.topbar_deck()}
              </a>
              <a href="/account" className={navLinkClass(pathname, "/account")}>
                {m.topbar_account()}
              </a>
              <form method="POST" action="/api/auth/signout" className="pt-2">
                <button type="submit" className={cn(linkBase, linkInactive, "block py-2 text-left text-base")}>
                  {m.topbar_signout()}
                </button>
              </form>
            </>
          ) : (
            <>
              <span className="pb-2 text-sm text-blue-100/70">{m.topbar_not_signed_in()}</span>
              <a href="/auth/signin" className={navLinkClass(pathname, "/auth/signin")}>
                {m.topbar_signin()}
              </a>
              <a href="/auth/signup" className={navLinkClass(pathname, "/auth/signup")}>
                {m.topbar_signup()}
              </a>
            </>
          )}
          <div className="pt-4">
            <LanguageSwitcher />
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
