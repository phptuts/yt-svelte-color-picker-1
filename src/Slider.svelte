<script>
  import Slider from "@smui/slider";
  export let min = 0;
  export let max = 255;
  export let color = 0;
  export let bgColor = "coral";
</script>

<div bp="grid">
  <div bp="10 offset-2">
    <Slider
      style="--mdc-theme-secondary: {bgColor}"
      {min}
      {max}
      discrete="true"
      bind:value={color} />
  </div>
</div>
