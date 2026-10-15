import Image from 'next/image';

export type AnnouncerPose = 'welcome' | 'explain' | 'thinking' | 'celebrate';
export type AnnouncerSize = 'small' | 'large' | number;

type SharedProps = {
  pose?: AnnouncerPose;
  size?: AnnouncerSize;
  className?: string;
};

export type AnnouncerPortraitProps = SharedProps & {
  /** Decorative by default because the speaker's name is normally shown as text. */
  decorative?: boolean;
  /** Required when decorative is false; describes the pose for assistive technology. */
  ariaLabel?: string;
};

const poseLabels: Record<AnnouncerPose, string> = {
  welcome: 'welcoming the viewer',
  explain: 'explaining a point',
  thinking: 'thinking',
  celebrate: 'celebrating',
};

const dimensions: Record<Exclude<AnnouncerSize, number>, number> = {
  small: 44,
  large: 240,
};

/** A locally bundled, original fan illustration of Dragon Ball's World Tournament Announcer. */
export function AnnouncerPortrait({
  pose = 'welcome',
  size = 'small',
  decorative = true,
  ariaLabel,
  className,
}: AnnouncerPortraitProps) {
  const width = typeof size === 'number' ? size : dimensions[size];
  const alt = decorative
    ? ''
    : ariaLabel ?? `Original fan illustration of the World Tournament Announcer ${poseLabels[pose]}`;

  return (
    <Image
      src={`/arena/tutorial/announcer-${pose}.svg`}
      alt={alt}
      width={240}
      height={300}
      unoptimized
      className={className}
      style={{ width, height: 'auto', maxWidth: '100%' }}
      data-announcer-pose={pose}
    />
  );
}
