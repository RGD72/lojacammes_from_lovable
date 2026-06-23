# Loja Cammes

## Edge Function secrets

The `submit-order` function invokes `notify-new-order` with a shared internal
secret. Configure the same non-empty value for `INTERNAL_FUNCTION_SECRET` in
the Supabase Edge Function environment before deploying:

```sh
supabase secrets set INTERNAL_FUNCTION_SECRET="<generate-a-long-random-secret>"
```

`notify-new-order` rejects requests without a matching `x-internal-secret`
header. If the secret is missing, notification delivery fails closed.
