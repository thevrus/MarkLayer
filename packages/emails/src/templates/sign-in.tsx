import { Button, Heading, Text } from '@react-email/components';
import { Layout } from '../Layout';
import { PLACEHOLDER } from './sign-in.meta';

export default function SignIn() {
  return (
    <Layout preview="Your sign-in link, good for 15 minutes">
      <Heading className="text-ml-fg m-0 mb-3 text-[24px] font-semibold tracking-[-0.02em]">
        Sign in to MarkLayer
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#4d4d4d]">
        Use the button below. The link works once and expires in 15 minutes.
      </Text>
      <Button
        href={PLACEHOLDER.link}
        className="bg-ml-btn text-ml-btn-fg inline-block rounded-[8px] px-5 py-3 text-[14px] font-medium no-underline"
      >
        Sign in
      </Button>
      {/* Some clients strip the anchor; a login email with no visible URL is a dead end. */}
      <Text className="m-0 mt-8 text-[13px] leading-[20px] text-[#8f8f8f]">
        Or paste this address into your browser:
        <br />
        <span className="break-all text-[#4d4d4d]">{PLACEHOLDER.link}</span>
      </Text>
      <Text className="m-0 mt-5 text-[13px] leading-[20px] text-[#8f8f8f]">
        If you did not ask to sign in, ignore this email and nothing will happen.
      </Text>
    </Layout>
  );
}
