"use client";
import { Button } from "./Button";
import { ComponentProps } from "react";

export function LoadingButton(props: ComponentProps<typeof Button>) {
  return <Button {...props} />;
}
