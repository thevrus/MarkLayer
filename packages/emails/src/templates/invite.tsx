import { Button, Heading, Text } from '@react-email/components';
import { Layout } from '../Layout';
import { PLACEHOLDER } from './invite.meta';

export default function Invite() {
  return (
    <Layout preview="You've been invited to view an annotation on MarkLayer">
      <Heading className="text-ml-fg m-0 mb-3 text-[24px] font-semibold tracking-[-0.02em]">
        You've been invited to an annotation
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#4d4d4d]">
        Someone shared a page they marked up on MarkLayer with you.
      </Text>
      <Button
        href={PLACEHOLDER.link}
        className="bg-ml-btn text-ml-btn-fg inline-block rounded-[8px] px-5 py-3 text-[14px] font-medium no-underline"
      >
        View annotation
      </Button>
      {/* Some clients strip the anchor; an invite with no visible URL is a dead end. */}
      <Text className="m-0 mt-8 text-[13px] leading-[20px] text-[#8f8f8f]">
        Or paste this address into your browser:
        <br />
        <span className="break-all font-mono text-[12px] text-[#4d4d4d]">{PLACEHOLDER.link}</span>
      </Text>
      {/* Unlike the sign-in email, this one can land on someone who never asked
          for anything — the same reassurance sign-in.tsx gives its recipient. */}
      <Text className="m-0 mt-5 text-[13px] leading-[20px] text-[#8f8f8f]">
        If you weren't expecting this, you can ignore it — nothing will happen.
      </Text>
    </Layout>
  );
}
