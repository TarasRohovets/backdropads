import { redirect } from "next/navigation";

// No landing page and no sign-in: the app is the product.
export default function Home() {
  redirect("/dashboard");
}
